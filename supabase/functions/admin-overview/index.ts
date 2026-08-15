import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Platform owner's view. The card-testing incident of 14 Aug 2026 ran for four
// days before anyone noticed, because there was nowhere to look: signups, tip
// volume and trust state lived in three systems and none of them talked. This
// returns the whole platform in one call - every performer, what they have
// earned, whether they are gated or frozen, and anything that smells.
//
// Gated by ADMIN_OPS_TOKEN. Read-only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_OPS_TOKEN = Deno.env.get("ADMIN_OPS_TOKEN") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = req.headers.get("x-admin-token") || "";
    if (!ADMIN_OPS_TOKEN || token !== ADMIN_OPS_TOKEN) {
      return new Response(JSON.stringify({ error: "nope" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: artists } = await admin
      .from("artists").select("id, name, email, stripe_onboarded, stripe_account_id");
    const { data: settings } = await admin.from("artist_settings").select("*");
    const sMap = new Map((settings || []).map((s: Record<string, unknown>) => [s.artist_id, s]));

    const rows = [];
    let flagged = 0;
    for (const a of artists || []) {
      const s = (sMap.get(a.id) || {}) as Record<string, unknown>;
      const { count: songs } = await admin.from("songs")
        .select("id", { count: "exact", head: true }).eq("artist_id", a.id);
      const { data: reqs } = await admin.from("requests")
        .select("tip_amount, requester_name, song_title").eq("artist_id", a.id).limit(500);
      const { data: played } = await admin.from("played_songs")
        .select("tip_amount").eq("artist_id", a.id).limit(1000);
      const { count: attempts24 } = await admin.from("tip_attempts")
        .select("id", { count: "exact", head: true })
        .eq("artist_id", a.id)
        .gt("created_at", new Date(Date.now() - 864e5).toISOString());

      const tips = [...(reqs || []), ...(played || [])]
        .map((r: Record<string, unknown>) => Number(r.tip_amount) || 0);
      const earned = tips.reduce((x, y) => x + y, 0);
      const tipped = tips.filter((t) => t > 0);
      const uniqueAmounts = new Set(tipped).size;
      const anonShare = (reqs || []).length
        ? (reqs || []).filter((r: Record<string, unknown>) =>
            !r.requester_name || r.requester_name === "Anonymous").length / (reqs || []).length
        : 0;

      // Heuristics that would have caught the August crew on day one.
      const smells: string[] = [];
      if (tipped.length >= 20 && uniqueAmounts <= 1) smells.push("every tip identical");
      if (tipped.length >= 20 && anonShare > 0.95) smells.push("all anonymous");
      if ((songs || 0) === 0 && tipped.length > 0) smells.push("earning with no song list");
      if (Number(attempts24) > 60) smells.push(`${attempts24} attempts in 24h`);
      if (smells.length) flagged++;

      rows.push({
        name: a.name,
        email: a.email,
        songs: songs || 0,
        requests: (reqs || []).length,
        tips: tipped.length,
        earned_usd: earned,
        attempts_24h: attempts24 || 0,
        state: s.tips_blocked ? "BLOCKED" : (s.trust_verified ? "verified" : "gated"),
        auto_flag: s.auto_flag_reason || null,
        pro: s.pro_active === true,
        stripe_ready: s.stripe_charges_enabled === true,
        smells,
      });
    }
    rows.sort((x, y) => (y.smells.length - x.smells.length) || (y.earned_usd - x.earned_usd));

    const { data: audit } = await admin
      .from("audit_log").select("at, actor, action, target, detail")
      .order("at", { ascending: false }).limit(25);

    return new Response(JSON.stringify({
      generated: new Date().toISOString(),
      performers: rows.length,
      flagged,
      rows,
      recent_activity: audit || [],
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
