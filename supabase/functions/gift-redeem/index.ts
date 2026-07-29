import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Redeems a gift code for the authed performer. Codes live behind RLS with
// no client policies - this function (service role) is the only door in.
// A granted gift sets pro_active without a Stripe subscription id, and
// pro-status only overwrites Pro state when a subscription id exists, so
// gifted Pro survives status syncs.

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
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error("That doesn't look like a code");

    const { data: gc } = await admin.from("gift_codes").select("*").eq("code", code).single();
    if (!gc || !gc.active) throw new Error("Code not recognized");
    if (gc.uses >= gc.max_uses) throw new Error("That code has been fully redeemed");

    const { error: redeemErr } = await admin.from("gift_redemptions")
      .insert([{ code: code, artist_id: artist.id }]);
    if (redeemErr) {
      if (/duplicate|unique/i.test(redeemErr.message || "")) {
        throw new Error("You already redeemed this code");
      }
      throw new Error("Could not redeem right now");
    }

    // Non-atomic counter is acceptable here: the per-artist unique key above
    // is the real gate, and max_uses on founder codes is intentionally huge.
    await admin.from("gift_codes").update({ uses: gc.uses + 1 }).eq("code", code);

    let periodEnd: string | null = null;
    if (gc.grants === "pro_year") periodEnd = new Date(Date.now() + 366 * 864e5).toISOString();
    if (gc.grants === "pro_month") periodEnd = new Date(Date.now() + 32 * 864e5).toISOString();

    await admin.from("artist_settings").upsert({
      artist_id: artist.id,
      pro_active: true,
      pro_plan: "gift",
      pro_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, grants: gc.grants }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
