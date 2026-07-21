import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
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
      .from("artists")
      .select("id, stripe_account_id, stripe_onboarded")
      .eq("auth_user_id", user.id)
      .single();
    if (artistErr || !artist) throw new Error("Artist profile not found");

    if (!artist.stripe_account_id) {
      // Keep the audience-facing readiness flag in sync (F2).
      await admin.from("artist_settings")
        .update({ stripe_charges_enabled: false })
        .eq("artist_id", artist.id);
      return new Response(JSON.stringify({ has_account: false, onboarded: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.stripe.com/v1/accounts/" + artist.stripe_account_id, {
      headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY },
    });
    const acct = await res.json();

    if (!res.ok) {
      // The stored account does not exist under the key we are running on, which
      // is what every test acct_ looks like after the switch to live keys.
      // Surfacing Stripe's raw error would strand the performer on a dashboard
      // showing a failure they cannot act on. Clear the dead id instead so the UI
      // falls back to "Set Up Payouts" and they can simply onboard again.
      // Stripe never documents which error a cross-mode account id returns, and
      // the runtime message people quote for it is not in the docs either, so
      // accept either plausible code rather than matching on text.
      const code = acct?.error?.code;
      if (res.status === 404 || code === "resource_missing" || code === "livemode_mismatch") {
        console.log("Clearing stale account " + artist.stripe_account_id + " for artist " + artist.id);
        await admin.from("artists")
          .update({ stripe_account_id: null, stripe_onboarded: false })
          .eq("id", artist.id);
        await admin.from("artist_settings")
          .update({ stripe_charges_enabled: false })
          .eq("artist_id", artist.id);
        return new Response(JSON.stringify({ has_account: false, onboarded: false, reset: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(acct.error?.message || "Stripe error");
    }

    // charges_enabled is satisfied by EITHER card_payments or transfers being
    // active, so on its own it does not prove the leg LiveQue actually uses. We
    // only ever move money by transfer on a destination charge, and Stripe warns
    // a capability can drop back out of active after go-live, so check it
    // directly. Tolerant of the field being absent: sandboxes are documented to
    // under-report capabilities and this must not strand a working test account.
    const transfers = acct.capabilities?.transfers;
    const transfersOk = transfers === undefined || transfers === "active";
    const onboarded = !!(
      acct.charges_enabled && acct.payouts_enabled && acct.details_submitted && transfersOk
    );
    if (onboarded !== artist.stripe_onboarded) {
      await admin.from("artists").update({ stripe_onboarded: onboarded }).eq("id", artist.id);
    }
    // Mirror readiness onto artist_settings so the anonymous audience page can
    // gate its tip buttons without reading the artists table (F2).
    await admin.from("artist_settings")
      .update({ stripe_charges_enabled: onboarded })
      .eq("artist_id", artist.id);

    return new Response(JSON.stringify({
      has_account: true,
      onboarded,
      charges_enabled: !!acct.charges_enabled,
      payouts_enabled: !!acct.payouts_enabled,
      details_submitted: !!acct.details_submitted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
