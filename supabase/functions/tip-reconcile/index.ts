import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Safety net for paid requests.
//
// THE BUG THIS FIXES: the queue row for a tipped request is created only by
// the Stripe webhook (payment_intent.succeeded). If that delivery fails or is
// slow, the fan is charged and their song never appears - reported live: "the
// $2 tip didn't show up but it sure went through somewhere". A webhook must
// never be the single point of failure between money and fulfilment.
//
// The client calls this with the PaymentIntent id a few seconds after a
// successful payment. Truth still comes from Stripe, never from the caller:
// we retrieve the intent, require status=succeeded, and take the artist, song,
// tip and requester from the intent's own metadata (set server-side when the
// intent was created). Insert is idempotent on stripe_payment_intent_id, so
// running alongside the webhook is harmless - whoever gets there first wins.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let piId = "";
    try {
      const body = await req.json();
      piId = String(body?.payment_intent_id || "").trim();
    } catch (_) { /* validated below */ }
    if (!/^pi_[A-Za-z0-9_]{6,}$/.test(piId)) throw new Error("Bad payment reference");

    const res = await fetch("https://api.stripe.com/v1/payment_intents/" + piId, {
      headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY },
    });
    const pi = await res.json();
    if (!res.ok) throw new Error(pi.error?.message || "Stripe error");
    if (pi.status !== "succeeded") {
      return new Response(JSON.stringify({ queued: false, status: pi.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const m = pi.metadata || {};
    if (!m.artist_id) throw new Error("Payment is not a LiveQue request");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Already fulfilled (webhook won the race, or this is a retry)?
    const { data: existing } = await admin
      .from("requests").select("id").eq("stripe_payment_intent_id", pi.id).limit(1);
    if (existing && existing.length) {
      return new Response(JSON.stringify({ queued: true, already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await admin
      .from("artist_settings").select("current_gig_session_id")
      .eq("artist_id", m.artist_id).single();

    const tip = parseInt(m.tip || "0", 10) || Math.round((pi.amount || 0) / 100);

    const { error } = await admin.from("requests").insert([{
      artist_id: m.artist_id,
      song_title: m.song_title || "Unknown",
      song_artist: m.song_artist || "Unknown",
      requester_name: m.requester_name || "Anonymous",
      tip_amount: tip,
      status: "queued",
      gig_session_id: settings?.current_gig_session_id || null,
      spanish: false,
      stripe_payment_intent_id: pi.id,
    }]);
    // 23505 = the webhook inserted it between our check and our insert.
    if (error && error.code !== "23505") throw new Error("Could not queue the request");

    return new Response(JSON.stringify({ queued: true, recovered: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
