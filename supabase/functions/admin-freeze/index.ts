import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Platform incident tool. Freezing payouts on a connected Express account is
// an API-only action - the dashboard's row menu for Express accounts offers
// nothing but "Request information" - so this exists to do it for the card
// testing accounts found on 14 Aug 2026.
//
// action=inspect : report balance, payout schedule and recent payouts
// action=freeze  : set the payout schedule to manual (money stays put)
// Gated by ADMIN_OPS_TOKEN. Never called by the app.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_OPS_TOKEN = Deno.env.get("ADMIN_OPS_TOKEN") || "";

async function sGet(path: string) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "Stripe error");
  return j;
}
async function sPost(path: string, params: URLSearchParams) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "Stripe error");
  return j;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = req.headers.get("x-admin-token") || "";
    if (!ADMIN_OPS_TOKEN || token !== ADMIN_OPS_TOKEN) {
      return new Response(JSON.stringify({ error: "nope" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "inspect");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: blocked } = await admin
      .from("artist_settings").select("artist_id").eq("tips_blocked", true);
    const ids = (blocked || []).map((b: Record<string, unknown>) => b.artist_id);
    const { data: artists } = await admin
      .from("artists").select("id, name, email, stripe_account_id").in("id", ids);

    const out: unknown[] = [];
    for (const a of artists || []) {
      const acct = a.stripe_account_id as string | null;
      if (!acct) { out.push({ name: a.name, email: a.email, note: "no stripe account" }); continue; }
      try {
        const account = await sGet("accounts/" + acct);
        const bal = await sGet("balance?stripe_account=" + acct).catch(() => null);
        const payouts = await sGet("payouts?limit=5&stripe_account=" + acct).catch(() => null);
        let frozen = account?.settings?.payouts?.schedule?.interval === "manual";

        if (action === "freeze" && !frozen) {
          await sPost("accounts/" + acct, new URLSearchParams({
            "settings[payouts][schedule][interval]": "manual",
          }));
          frozen = true;
          try {
            await admin.rpc("audit", {
              p_actor: "admin", p_action: "payouts_frozen", p_target: acct,
              p_ip: null, p_detail: { name: a.name },
            });
          } catch (_) { /* best effort */ }
        }

        out.push({
          name: a.name,
          email: a.email,
          account: acct,
          country: account?.country,
          payouts_schedule: frozen ? "manual (FROZEN)" : account?.settings?.payouts?.schedule?.interval,
          payouts_enabled: account?.payouts_enabled,
          charges_enabled: account?.charges_enabled,
          available: bal?.available?.map((x: Record<string, unknown>) => `${x.currency}:${x.amount}`),
          pending: bal?.pending?.map((x: Record<string, unknown>) => `${x.currency}:${x.amount}`),
          payouts_made: (payouts?.data || []).map((p: Record<string, unknown>) =>
            `${p.amount}c ${p.status} ${new Date((p.arrival_date as number) * 1000).toISOString().slice(0, 10)}`),
        });
      } catch (e) {
        out.push({ name: a.name, account: acct, error: (e as Error).message });
      }
    }
    return new Response(JSON.stringify({ action, accounts: out }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
