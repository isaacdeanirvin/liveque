import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Redeems a gift code for the authed performer. The whole redemption is one
// atomic SQL function (row lock + per-artist unique + counted uses), so
// max_uses cannot be raced past. Gifts write ONLY pro_gift/pro_gift_until -
// paid-subscription columns are a separate rail and neither can clobber the
// other. Effective Pro = paid OR unexpired gift, computed at read time.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: artist, error: artistErr } = await admin
      .from("artists").select("id").eq("auth_user_id", user.id).single();
    if (artistErr || !artist) throw new Error("Artist profile not found");

    let code = "";
    try {
      const body = await req.json();
      code = String(body?.code || "").trim().toUpperCase();
    } catch (_) { /* fallthrough to validation */ }
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) {
      await new Promise((r) => setTimeout(r, 400));
      throw new Error("That doesn't look like a code");
    }

    const { data: grants, error: rpcErr } = await admin
      .rpc("gift_redeem_atomic", { p_code: code, p_artist: artist.id });
    if (rpcErr) throw new Error("Could not redeem right now");
    if (grants === "not_found" || grants === "exhausted" || grants === "already") {
      // Small uniform delay keeps guessing slow and unrevealing.
      await new Promise((r) => setTimeout(r, 400));
      const msg = grants === "already" ? "You already redeemed this code"
        : grants === "exhausted" ? "That code has been fully redeemed"
        : "Code not recognized";
      throw new Error(msg);
    }

    let giftUntil: string | null = null;
    if (grants === "pro_year") giftUntil = new Date(Date.now() + 366 * 864e5).toISOString();
    if (grants === "pro_month") giftUntil = new Date(Date.now() + 32 * 864e5).toISOString();

    await admin.from("artist_settings").upsert({
      artist_id: artist.id,
      pro_gift: true,
      pro_gift_until: giftUntil,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, grants: grants }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
