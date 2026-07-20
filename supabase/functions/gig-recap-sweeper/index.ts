// gig-recap-sweeper -- cron-triggered. Finds gigs that have gone quiet for 6+
// hours and emails the performer their recap, even if their dashboard is closed.
//
// Trigger: a scheduled pg_cron job POSTs here hourly with an x-sweep-secret
// header (see sql/2026-07-20-recap-sweep.sql). Dedupe is shared with the client
// via artist_settings.recap_sent_session, so a gig is never recapped twice.
//
// The recap template is NOT here -- it lives in liveque-email, which this
// function calls. Keeping one copy is deliberate; two copies drifted before.
//
// Secrets: SWEEP_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SWEEP_SECRET = Deno.env.get("SWEEP_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IDLE_MS = 6 * 60 * 60 * 1000;

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
      " - " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  } catch (_) { return ""; }
}
// The recap template lives in liveque-email and ONLY there. This function used
// to carry its own copy; the two drifted (differing closer and footer copy), so
// the auto-sent recap most performers actually receive did not match the manual
// one. Delegate instead of duplicating.
async function sendRecap(to: string, name: string, stats: Record<string, unknown>) {
  const res = await fetch(SUPABASE_URL + "/functions/v1/liveque-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + SERVICE_ROLE,
      "x-internal-secret": SWEEP_SECRET,
    },
    body: JSON.stringify({ type: "recap", to, name, stats }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "recap send failed");
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
        duration: startMs ? fmtDur(lastMs - startMs) : "--",
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
      try { await sendRecap(artist.email, artist.name || "", stats); } catch (_) { /* captured; will not retry */ }
      sent++;
    }
    return new Response(JSON.stringify({ ok: true, checked, sent }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message || err), checked, sent }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
