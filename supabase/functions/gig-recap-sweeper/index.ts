// gig-recap-sweeper — cron-triggered. Finds gigs that have gone quiet for 6+
// hours and emails the performer their recap, even if their dashboard is closed.
//
// Trigger: a scheduled pg_cron job POSTs here hourly with an x-sweep-secret
// header (see sql/2026-07-20-recap-sweep.sql). Dedupe is shared with the client
// via artist_settings.recap_sent_session, so a gig is never recapped twice.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (optional), SWEEP_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "LiveQue <onboarding@resend.dev>";
const SWEEP_SECRET = Deno.env.get("SWEEP_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IDLE_MS = 6 * 60 * 60 * 1000;

function esc(v: unknown): string {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function gigStartMs(sid: string): number | null {
  const pp = String(sid || "").split("-");
  const ts = parseInt(pp[1], 10);
  return (pp[0] === "gig" && !isNaN(ts)) ? ts : null;
}
function fmtDur(ms: number): string {
  if (ms < 0) ms = 0;
  let m = Math.floor(ms / 60000); const h = Math.floor(m / 60); m = m % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) +
      " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  } catch (_) { return ""; }
}
function statBox(value: string, label: string): string {
  return `<td width="50%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:26px;font-weight:800;color:#ffd700;line-height:1;">${esc(value)}</div><div style="font-size:11px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;">${esc(label)}</div></td></tr></table></td>`;
}
function recapHtml(name: string, s: Record<string, unknown>): string {
  const topSong = s.topSong ? `<tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(78,205,196,0.08);border:1px solid rgba(78,205,196,0.25);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:11px;color:#4ecdc4;text-transform:uppercase;letter-spacing:0.5px;">Crowd favorite</div><div style="font-size:17px;font-weight:700;color:#fff;margin-top:6px;">${esc(s.topSong)}</div></td></tr></table></td></tr>` : "";
  const rc = Number(s.ratingCount) || 0;
  const ra = Math.round(Number(s.ratingAvg) || 0);
  const rating = rc > 0 ? `<tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.22);border-radius:12px;"><tr><td style="padding:16px;text-align:center;"><div style="font-size:22px;color:#ffd700;letter-spacing:2px;">${"&#9733;".repeat(ra)}${"&#9734;".repeat(5 - ra)}</div><div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px;">${esc(s.ratingAvg)} from ${rc} rating${rc === 1 ? "" : "s"}</div></td></tr></table></td></tr>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0f0f12;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f12;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#17171c;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:26px 32px;background:linear-gradient(135deg,#12433a,#0f0f12);"><span style="font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.5px;">LiveQue<span style="font-size:11px;color:#4ecdc4;vertical-align:super;">TM</span></span></td></tr>
<tr><td style="padding:32px 32px 8px;color:#e9e9ee;">
<h1 style="margin:0 0 4px;font-size:22px;color:#fff;font-weight:700;">That's a wrap${name ? ", " + esc(name) : ""}!</h1>
<div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:18px;">${esc(s.gigDate || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><tr><td style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#12433a,#1b1b22);border:1px solid rgba(78,205,196,0.3);border-radius:14px;"><tr><td style="padding:22px;text-align:center;"><div style="font-size:12px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1px;">Tips collected</div><div style="font-size:40px;font-weight:800;color:#ffd700;margin-top:4px;line-height:1;">$${esc(s.tipsTotal ?? 0)}</div></td></tr></table></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${statBox(String(s.songsPlayed ?? 0), "Songs played")}${statBox(String(s.tipsCount ?? 0), "Tips")}</tr>
<tr>${statBox(String(s.requests ?? 0), "Requests")}${statBox(String(s.duration ?? "—"), "Set length")}</tr>
${topSong}${rating}
</table>
<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7);">Nicely done. Your queue resets for next time — break a leg out there.</p>
<p style="margin:14px 0 0;font-size:14px;color:rgba(255,255,255,0.6);">— Isaac &amp; Glen, LiveQue</p>
</td></tr>
<tr><td style="padding:22px 32px;border-top:1px solid rgba(255,255,255,0.08);"><div style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.6;">Sent by LiveQue &middot; <a href="https://getliveque.com" style="color:#4ecdc4;text-decoration:none;">getliveque.com</a><br>Reply with any feedback — we read every one.</div></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendResend(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error((await res.json())?.message || "Resend error");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  // Guard: only the scheduled job (with the shared secret) may run the sweep.
  if (!SWEEP_SECRET || req.headers.get("x-sweep-secret") !== SWEEP_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();
  let sent = 0, checked = 0;
  try {
    const { data: settings } = await supabase
      .from("artist_settings")
      .select("artist_id,current_gig_session_id,recap_sent_session")
      .not("current_gig_session_id", "is", null);

    for (const s of settings || []) {
      checked++;
      const sid: string = s.current_gig_session_id;
      if (!sid || s.recap_sent_session === sid) continue;

      const [{ data: played }, { data: queued }] = await Promise.all([
        supabase.from("played_songs").select("song_title,tip_amount,played_at").eq("artist_id", s.artist_id).eq("gig_session_id", sid),
        supabase.from("requests").select("song_title,tip_amount,requested_at").eq("artist_id", s.artist_id).eq("gig_session_id", sid),
      ]);
      const P = played || [], Q = queued || [];
      const times = [...P.map((r) => Date.parse(r.played_at)), ...Q.map((r) => Date.parse(r.requested_at))].filter((n) => !isNaN(n));
      if (times.length === 0) continue;                 // nothing happened
      const lastMs = Math.max(...times);
      if (now - lastMs < IDLE_MS) continue;             // still within the active window

      const { data: artist } = await supabase.from("artists").select("name,email").eq("id", s.artist_id).single();
      if (!artist?.email) continue;                     // no address to send to

      const songsPlayed = P.length;
      const tipsTotal = P.reduce((a, r) => a + (r.tip_amount || 0), 0) + Q.reduce((a, r) => a + (r.tip_amount || 0), 0);
      const tipsCount = P.filter((r) => (r.tip_amount || 0) > 0).length + Q.filter((r) => (r.tip_amount || 0) > 0).length;
      const requests = songsPlayed + Q.length;
      const all = [...P.map((r) => ({ t: r.song_title, tip: r.tip_amount || 0 })), ...Q.map((r) => ({ t: r.song_title, tip: r.tip_amount || 0 }))].sort((a, b) => b.tip - a.tip);
      const topSong = (all[0] && all[0].tip > 0) ? all[0].t : "";
      const startMs = gigStartMs(sid);

      let ratingAvg = "", ratingCount = 0;
      try {
        const { data: rv } = await supabase.from("reviews").select("stars").eq("artist_id", s.artist_id).eq("gig_session_id", sid);
        if (rv && rv.length) { ratingCount = rv.length; ratingAvg = (rv.reduce((a, r) => a + (r.stars || 0), 0) / rv.length).toFixed(1); }
      } catch (_) { /* reviews table may be absent */ }

      const stats = {
        gigDate: startMs ? fmtDate(startMs) : "",
        duration: startMs ? fmtDur(lastMs - startMs) : "—",
        songsPlayed, requests, tipsTotal, tipsCount, topSong, ratingAvg, ratingCount,
      };

      // Capture the gig + mark finalized BEFORE emailing, so a send failure never
      // double-captures or re-sends on the next sweep.
      await supabase.from("gigs").insert([{
        artist_id: s.artist_id, gig_session_id: sid,
        gig_date: startMs ? new Date(startMs).toISOString() : null,
        duration_minutes: startMs ? Math.max(0, Math.floor((lastMs - startMs) / 60000)) : null,
        songs_played: songsPlayed, requests, tips_total: tipsTotal, tips_count: tipsCount,
        top_song: topSong || null, rating_avg: ratingAvg ? Number(ratingAvg) : null,
        rating_count: ratingCount, ended_via: "auto",
      }]);
      await supabase.from("artist_settings").update({ recap_sent_session: sid }).eq("artist_id", s.artist_id);
      try { await sendResend(artist.email, "Your LiveQue gig recap", recapHtml(artist.name || "", stats)); } catch (_) { /* captured; will not retry */ }
      sent++;
    }
    return new Response(JSON.stringify({ ok: true, checked, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message || err), checked, sent }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
