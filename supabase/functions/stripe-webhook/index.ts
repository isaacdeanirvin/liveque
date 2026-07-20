import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@16.12.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const bodyText = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      bodyText, sig!, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider
    );
  } catch (err) {
    return new Response("Bad signature: " + err.message, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    const m = pi.metadata || {};
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

      let gigSession = null;
      if (m.artist_id) {
        const { data: settings } = await admin
          .from("artist_settings")
          .select("current_gig_session_id")
          .eq("artist_id", m.artist_id)
          .single();
        gigSession = settings?.current_gig_session_id || null;
      }

      const tip = parseInt(m.tip || "0", 10) || Math.round((pi.amount || 0) / 100);

      const { error } = await admin.from("requests").insert([{
        artist_id: m.artist_id,
        song_title: m.song_title || "Unknown",
        song_artist: m.song_artist || "Unknown",
        requester_name: m.requester_name || "Anonymous",
        tip_amount: tip,
        status: "queued",
        gig_session_id: gigSession,
        spanish: false,
        stripe_payment_intent_id: pi.id,
      }]);

      // 23505 = duplicate (Stripe retried the same event) — safe to ignore
      if (error && error.code !== "23505") {
        console.error("Insert error:", error);
        return new Response("Insert failed", { status: 500 });
      }
    } catch (e) {
      console.error("Webhook handler error:", e);
      return new Response("Handler error", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});