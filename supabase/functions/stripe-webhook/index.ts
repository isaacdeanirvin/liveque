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

  // A LIVE endpoint receives test events as well as live ones. Stripe's own
  // Connect docs say so: "your production webhook URLs receive both live and
  // test webhooks". Without this guard, anyone able to trigger a test payment
  // causes real fulfilment in production: a song queued, a tip counted, a recap
  // sent. Fulfil only what matches the key this function is running on.
  const RUNNING_LIVE = STRIPE_SECRET_KEY.startsWith("sk_live_");
  if (event.livemode !== RUNNING_LIVE) {
    console.log(
      `Ignoring ${event.type}: event.livemode=${event.livemode} but this ` +
      `deployment is ${RUNNING_LIVE ? "live" : "test"}`,
    );
    // 2xx so Stripe stops retrying. This is a deliberate no-op, not a failure.
    return new Response(JSON.stringify({ received: true, ignored: "mode mismatch" }), {
      headers: { "Content-Type": "application/json" },
    });
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

  // We use destination charges (transfer_data[destination] in stripe-create-tip).
  // Stripe debits DISPUTES FROM THE PLATFORM BALANCE, not from the performer, and
  // on_behalf_of does not change that. Since LiveQue takes 0%, an unhandled $5
  // dispute costs us $5 plus the dispute fee against zero revenue. Reversing the
  // transfer pulls the money back out of the performer's account instead.
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object;
    try {
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) throw new Error("Dispute " + dispute.id + " had no charge id");

      const charge = await stripe.charges.retrieve(chargeId);
      const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id;

      if (transferId) {
        try {
          // The transfer is the charge MINUS the application fee (we pass the Stripe
          // cost through), so it is smaller than the disputed amount. Reversing
          // dispute.amount would exceed the transfer and fail, so clamp to what was
          // actually sent and to what has not already been reversed.
          const transfer = await stripe.transfers.retrieve(transferId);
          const reversible = (transfer.amount || 0) - (transfer.amount_reversed || 0);
          const reverseAmount = Math.min(dispute.amount ?? reversible, reversible);

          if (reverseAmount <= 0) {
            console.log("Transfer " + transferId + " already fully reversed");
          } else {
            // Keyed on the dispute id so Stripe's retries cannot double-reverse.
            await stripe.transfers.createReversal(
              transferId,
              { amount: reverseAmount },
              { idempotencyKey: "liveque-dispute-" + dispute.id },
            );
            console.log(
              "Reversed " + reverseAmount + "c on transfer " + transferId +
              " for dispute " + dispute.id,
            );
          }
        } catch (revErr) {
          // Usually means the performer was already paid out and their balance is
          // short. Stripe only chases it if debit_negative_balances is on. Loud on
          // purpose: this is the case where LiveQue actually eats the money.
          console.error(
            "REVERSAL FAILED, platform absorbs this one. dispute=" + dispute.id +
            " transfer=" + transferId + " reason=" + (revErr?.message || revErr),
          );
        }
      } else {
        console.error("No transfer on charge " + chargeId + " for dispute " + dispute.id);
      }

      // Drop the request back to unpaid. It keeps its place in the queue but loses
      // the priority it no longer paid for. Deliberately not inventing a new status
      // value the dashboard has never had to render.
      const piId = typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
      if (piId) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
        const { error } = await admin
          .from("requests")
          .update({ tip_amount: 0 })
          .eq("stripe_payment_intent_id", piId);
        if (error) console.error("Could not clear tip for disputed " + piId + ":", error);
      }
    } catch (e) {
      console.error("Dispute handler error:", e);
      return new Response("Handler error", { status: 500 });
    }
  }

  // Performer readiness, pushed rather than polled.
  //
  // Until now the only thing that wrote stripe_charges_enabled was the performer
  // opening their own dashboard, which calls stripe-status. That means someone
  // can finish Stripe onboarding, close the tab, and their fan page still shows
  // no tip buttons at their next gig. Stripe knows the moment KYC clears; this
  // lets it tell us.
  //
  // Requires a webhook endpoint scoped to CONNECTED ACCOUNTS subscribed to
  // account.updated. A normal account endpoint will not deliver this.
  if (event.type === "account.updated") {
    const acct = event.data.object;
    try {
      // Same rule as stripe-status, and it has to stay the same rule: these two
      // are the only writers of readiness, so if they ever disagree a performer
      // flips between ready and not depending on which one ran last.
      const transfers = acct.capabilities?.transfers;
      const transfersOk = transfers === undefined || transfers === "active";
      const onboarded = !!(
        acct.charges_enabled && acct.payouts_enabled && acct.details_submitted && transfersOk
      );
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

      const { data: artist } = await admin
        .from("artists")
        .select("id, stripe_onboarded")
        .eq("stripe_account_id", acct.id)
        .maybeSingle();

      if (!artist) {
        console.log("account.updated for an unknown account " + acct.id);
      } else {
        if (artist.stripe_onboarded !== onboarded) {
          await admin.from("artists").update({ stripe_onboarded: onboarded }).eq("id", artist.id);
        }
        // Mirror onto artist_settings, which is the only one of the two the
        // anonymous fan page is allowed to read.
        await admin.from("artist_settings")
          .update({ stripe_charges_enabled: onboarded })
          .eq("artist_id", artist.id);
        console.log(
          `account.updated ${acct.id} -> onboarded=${onboarded} ` +
          `(charges=${!!acct.charges_enabled} payouts=${!!acct.payouts_enabled} ` +
          `details=${!!acct.details_submitted})`,
        );
      }
    } catch (e) {
      console.error("account.updated handler error:", e);
      return new Response("Handler error", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});