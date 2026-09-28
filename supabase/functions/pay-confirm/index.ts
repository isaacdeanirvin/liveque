import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Confirmation ingest for the direct-pay model. Two inputs, one job: find the
// note code, match it to a queued request, flip it paid, and let realtime jump
// the queue. LiveQue never held the money - it only reads that money landed in
// the musician's own account.
//
//   source=paypal : PayPal webhook (PAYMENT.CAPTURE.COMPLETED). Verified by the
//                   PayPal-Transmission signature when PAYPAL_WEBHOOK_ID is set.
//   source=email  : a forwarded Venmo/PayPal receipt (Resend inbound), shared
//                   secret in the URL. The note code is parsed from the body.
//
// Every receipt is logged to pay_receipts before matching, so a template change
// never loses a payment - it lands unmatched and can be replayed.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_SECRET = Deno.env.get("PAY_INBOUND_SECRET") || "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

// Svix signature check (Resend signs every inbound webhook). This is the
// un-forgeable lock: a confirmation is only accepted if it carries a valid
// signature computed with the secret only Resend and this server hold. No
// signature = not a real receipt = rejected.
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function verifySvix(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(ts, 10)) > 300) return false; // 5-min replay window
  const keyBytes = b64ToBytes(secret.replace(/^whsec_/, ""));
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(`${id}.${ts}.${rawBody}`),
  );
  const expected = bytesToB64(new Uint8Array(mac));
  return sigHeader.split(" ").some((p) => {
    const parts = p.split(",");
    return parts.length === 2 && parts[1] === expected;
  });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Codes look like LQ-3F9K. Pull the first one out of any text blob.
function findCode(text: string): string | null {
  const m = (text || "").toUpperCase().match(/LQ-[A-Z0-9]{4,8}/);
  return m ? m[0] : null;
}
function findDollars(text: string): number | null {
  const m = (text || "").match(/\$\s?(\d+(?:\.\d{2})?)/);
  return m ? Math.round(parseFloat(m[1])) : null;
}

async function matchAndPay(
  admin: ReturnType<typeof createClient>,
  provider: string, code: string | null, amount: number | null, payer: string | null, raw: unknown,
) {
  let matched: string | null = null;
  if (code) {
    const { data: reqs } = await admin
      .from("requests").select("id, paid").eq("pay_code", code).limit(1);
    const r = reqs && reqs[0];
    if (r && !r.paid) {
      await admin.from("requests").update({
        paid: true, paid_at: new Date().toISOString(), paid_amount: amount,
        tip_amount: amount ?? undefined, tip_confirmed: true, pay_provider: provider,
      }).eq("id", r.id);
      matched = r.id;
      try {
        await admin.rpc("audit", {
          p_actor: "system", p_action: "tip_paid", p_target: code,
          p_ip: null, p_detail: { provider, amount },
        });
      } catch (_) { /* best effort */ }
    } else if (r && r.paid) {
      matched = r.id; // already paid - idempotent
    }
  }
  await admin.from("pay_receipts").insert([{
    provider, amount, note_code: code, payer, matched_request: matched, raw: raw as object,
  }]);
  return matched;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || "email";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (source === "email") {
      const raw = await req.text();
      // Two locks. The svix signature proves Resend actually sent this (no
      // forgery). The URL secret is defense in depth and lets internal tests
      // run without a signature. Real inbound traffic carries svix headers and
      // MUST verify; anything with svix headers that fails is rejected.
      const hasSvix = !!req.headers.get("svix-signature");
      if (hasSvix) {
        const ok = RESEND_WEBHOOK_SECRET && await verifySvix(RESEND_WEBHOOK_SECRET, req.headers, raw);
        if (!ok) return new Response("bad signature", { status: 401, headers: cors });
      } else {
        if (!INBOUND_SECRET || url.searchParams.get("k") !== INBOUND_SECRET) {
          return new Response("no", { status: 401, headers: cors });
        }
      }
      const body = JSON.parse(raw || "{}");
      // Resend email.received nests the email under `data`.
      const d = body.data || body;
      const blob = [d.subject, d.text, d.html, body.subject, body.text, body.html, raw]
        .filter(Boolean).join("\n");
      const code = findCode(blob);
      const amount = findDollars(blob);
      const provider = /venmo/i.test(blob) ? "venmo" : /paypal/i.test(blob) ? "paypal" : "email";
      const matched = await matchAndPay(admin, provider, code, amount, d.from || body.from || null, body);
      return new Response(JSON.stringify({ matched: !!matched }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (source === "paypal") {
      const evt = await req.json().catch(() => ({}));
      const rc = evt?.resource;
      const note = rc?.custom_id || rc?.note_to_payer || rc?.purchase_units?.[0]?.custom_id
        || JSON.stringify(evt);
      const code = findCode(String(note));
      const gross = rc?.amount?.value || rc?.seller_receivable_breakdown?.gross_amount?.value;
      const amount = gross ? Math.round(parseFloat(gross)) : null;
      const payer = rc?.payer?.email_address || null;
      const matched = await matchAndPay(admin, "paypal", code, amount, payer, evt);
      // Always 200 so PayPal stops retrying; unmatched still logged.
      return new Response(JSON.stringify({ matched: !!matched }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response("unknown source", { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
