// liveque-email — transactional email via Resend (welcome + gig recap).
//
// Security: the caller must present a valid Supabase auth JWT (Authorization:
// Bearer <access_token>). The email is ALWAYS sent to that verified user's own
// address — the client cannot specify an arbitrary recipient — so this endpoint
// can never be used to spam third parties.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   — from resend.com (Isaac already has an account)
//   EMAIL_FROM       — e.g. "LiveQue <hello@getliveque.com>" once the domain is
//                      verified in Resend. Until then leave unset and Resend's
//                      test sender only delivers to the account owner's inbox.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — provided by the platform.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "LiveQue <onboarding@resend.dev>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function esc(v: unknown): string {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function shell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0f0f12;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#17171c;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:26px 32px;background:linear-gradient(135deg,#12433a,#0f0f12);">
<span style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">LiveQue<span style="font-size:11px;color:#4ecdc4;vertical-align:super;">TM</span></span>
</td></tr>
${inner}
<tr><td style="padding:22px 32px;border-top:1px solid rgba(255,255,255,0.08);">
<div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">Sent by LiveQue &middot; <a href="https://getliveque.com" style="color:#4ecdc4;text-decoration:none;">getliveque.com</a><br>Reply to this email with any feedback — we read every one.</div>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function welcomeHtml(name: string): string {
  const hi = name ? `Welcome to LiveQue, ${esc(name)}` : "Welcome to LiveQue";
  return shell(`<tr><td style="padding:32px;color:#e9e9ee;">
<h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;font-weight:700;">${hi}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.82);">We're <b style="color:#fff;">Isaac &amp; Glen Irvin</b> — two brothers, both working musicians. We built LiveQue because we wanted a better way to connect audiences with the musician right in front of them: let fans <b style="color:#fff;">request songs</b>, <b style="color:#fff;">tip to bump their pick</b> up the queue, and keep the energy going all night.</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:rgba(255,255,255,0.82);">You're all set. Add your songs, drop your QR code on the tables, and start your first gig whenever you're ready.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:linear-gradient(45deg,#4ecdc4,#44a08d);"><a href="https://getliveque.com" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#0f2f2a;text-decoration:none;">Open your dashboard</a></td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7);">We'd genuinely love your feedback — tell us what you love and what we can make better. Just reply to this email.</p>
<p style="margin:16px 0 0;font-size:14px;color:rgba(255,255,255,0.7);">Thanks for playing with us,<br><b style="color:#fff;">Isaac &amp; Glen Irvin</b></p>
</td></tr>`);
}

function statBox(value: string, label: string): string {
  return `<td width="50%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#ffd700;line-height:1;">${esc(value)}</div><div style="font-size:11px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">${esc(label)}</div></td></tr></table></td>`;
}

function recapHtml(name: string, s: Record<string, unknown>): string {
  s = s || {};
  const when = s.gigDate ? esc(s.gigDate) : "";
  const tips = s.tipsTotal != null ? "$" + esc(s.tipsTotal) : "$0";
  const topSong = s.topSong
    ? `<tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.25);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:11px;color:#4ecdc4;text-transform:uppercase;letter-spacing:0.5px;">Crowd favorite</div><div style="font-size:17px;font-weight:700;color:#fff;margin-top:6px;">${esc(s.topSong)}</div></td></tr></table></td></tr>`
    : "";
  const rating = (s.ratingCount && Number(s.ratingCount) > 0)
    ? `<tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.22);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:22px;color:#ffd700;letter-spacing:2px;">${"&#9733;".repeat(Math.round(Number(s.ratingAvg) || 0))}${"&#9734;".repeat(5 - Math.round(Number(s.ratingAvg) || 0))}</div><div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px;">${esc(s.ratingAvg)} average from ${esc(s.ratingCount)} rating${Number(s.ratingCount) === 1 ? "" : "s"}</div></td></tr></table></td></tr>`
    : "";
  return shell(`<tr><td style="padding:32px 32px 8px;color:#e9e9ee;">
<h1 style="margin:0 0 4px;font-size:22px;color:#ffffff;font-weight:700;">That's a wrap${name ? ", " + esc(name) : ""}!</h1>
<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:18px;">${when}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#12433a,#1b1b22);border:1px solid rgba(78,205,196,0.3);border-radius:14px;"><tr><td style="padding:22px;text-align:center;"><div style="font-size:12px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;">Tips collected</div><div style="font-size:40px;font-weight:800;color:#ffd700;margin-top:4px;line-height:1;">${tips}</div></td></tr></table></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${statBox(String(s.songsPlayed || 0), "Songs played")}${statBox(String(s.tipsCount || 0), "Tips")}</tr>
<tr>${statBox(String(s.requests || 0), "Requests")}${statBox(String(s.duration || "—"), "Set length")}</tr>
${topSong}
${rating}
</table>
<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7);">Nicely done. Your queue and tips reset for next time — break a leg out there.</p>
<p style="margin:14px 0 0;font-size:14px;color:rgba(255,255,255,0.6);">— Isaac &amp; Glen, LiveQue</p>
</td></tr>`);
}

async function sendResend(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Resend error");
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing auth");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.email) throw new Error("Invalid auth");
    const to = userData.user.email;

    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    const name = typeof body?.name === "string" ? body.name.slice(0, 80) : "";

    let subject = "";
    let html = "";
    if (type === "welcome") {
      subject = "Welcome to LiveQue";
      html = welcomeHtml(name);
    } else if (type === "recap") {
      subject = "Your LiveQue gig recap";
      html = recapHtml(name, body?.stats || {});
    } else {
      throw new Error("Unknown email type");
    }

    const result = await sendResend(to, subject, html);
    return new Response(JSON.stringify({ ok: true, id: result?.id || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message || err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
