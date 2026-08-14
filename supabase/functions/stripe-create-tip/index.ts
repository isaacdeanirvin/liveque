import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_PUBLISHABLE_KEY = Deno.env.get("STRIPE_PUBLISHABLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    // Carry the machine-readable code through. Callers need to branch on the
    // cause without matching on Stripe's prose, which is undocumented and free
    // to change.
    const err: Error & { code?: string; status?: number } =
      new Error(data.error?.message || "Stripe error");
    err.code = data.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { artist_id, amount, song_title, song_artist, requester_name, cover_fees } = body;
    // Strictly boolean. Anything truthy-but-not-true is treated as not covering, so a
    // malformed client can only ever undercharge the fan, never overcharge them.
    const coverFees = cover_fees === true;

    if (!artist_id) throw new Error("Missing artist");

    // Never trust the client with money math (front-end code cannot be hidden).
    // Require a whole-dollar integer in a sane range: this rejects non-integers
    // (e.g. 0.5), zero/negative, and absurd values before touching Stripe.
    const dollars = Number(amount);
    if (!Number.isInteger(dollars) || dollars < 1 || dollars > 500) {
      throw new Error("Invalid tip amount");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: artist, error } = await admin
      .from("artists")
      .select("id, stripe_account_id, stripe_onboarded")
      .eq("id", artist_id)
      .single();
    if (error || !artist) throw new Error("Artist not found");
    if (!artist.stripe_account_id || !artist.stripe_onboarded) {
      throw new Error("This performer isn't set up for in-app tips yet");
    }

    // Bind the charge to one of the performer's own configured tip options, so a
    // forged invoke cannot charge an arbitrary amount. If this performer has no
    // configured amounts, fall back to the range check above.
    const { data: settings } = await admin
      .from("artist_settings")
      .select("tip_amounts, tips_blocked")
      .eq("artist_id", artist_id)
      .single();

    // ANTI CARD-TESTING (14 Aug 2026). Four sham "performer" accounts ran ~263
    // identical $9 charges in days, with cardholder names typed into the song
    // field. Destination charges mean disputes hit the PLATFORM balance, so this
    // endpoint is the front door to the platform's money and gets two locks: a
    // per-artist kill switch, and a rate limit a real bar never reaches but a
    // card tester trips within seconds.
    if (settings?.tips_blocked) {
      throw new Error("This performer isn't set up for in-app tips yet");
    }
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const { data: rateOk } = await admin.rpc("tip_rate_ok", {
      p_artist: artist_id, p_ip: ip, p_amount: dollars,
    });
    if (rateOk === false) {
      console.warn("Tip rate limit hit", { artist_id, ip });
      throw new Error("Too many attempts right now. Please wait a moment and try again.");
    }

    const allowed = Array.isArray(settings?.tip_amounts)
      ? settings.tip_amounts.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (allowed.length && !allowed.includes(dollars)) {
      throw new Error("Invalid tip amount");
    }

    // Pass the card cost through, take nothing on top.
    //
    // On destination charges Stripe debits the PLATFORM for its processing fee and
    // transfers the FULL charge to the connected account. With no application fee we
    // were paying $0.45 out of pocket on every $5 tip while taking 0%, and the
    // performer was receiving $5.00 rather than the $4.55 our pricing page states.
    // Setting application_fee_amount to exactly the Stripe fee routes that cost back
    // to us to settle with Stripe, leaving LiveQue at zero and the performer at the
    // published number.
    //
    // 500c -> round(14.5)+30 = 45c -> performer 455c. 200c -> round(5.8)+30 = 36c
    // -> performer 164c. Both match the ledger on the landing page exactly.
    //
    // Domestic US card pricing. An international card costs Stripe's extra 1.5%,
    // which LiveQue absorbs rather than surprising the performer with a variable cut.
    const tipCents = dollars * 100;

    // If the fan opts to cover the card cost, gross up so the performer nets the full
    // tip. The fee applies to the LARGER total, so it is not simply tip + fee:
    //   charge - (0.029*charge + 30) = tip   ->   charge = (tip + 30) / 0.971
    // A $5 tip covered costs the fan $5.46, not $5.45. Ceiling rather than round, so
    // the performer is never a cent short.
    const chargeCents = coverFees
      ? Math.ceil((tipCents + 30) / 0.971)
      : tipCents;

    const stripeFeeCents = Math.min(
      Math.round(chargeCents * 0.029) + 30,
      chargeCents - 1, // never leave the performer with nothing
    );

    // Sanity gate. If the gross-up ever fails to leave the performer whole, or the
    // fan would be charged more than a sane multiple of the tip, refuse rather than
    // quietly overcharge someone standing in a bar.
    if (coverFees && (chargeCents - stripeFeeCents < tipCents || chargeCents > tipCents * 2 + 100)) {
      throw new Error("Could not calculate the fee-covered total");
    }

    // A destination account that is dead in the current mode (every test acct_ is,
    // once live keys are in) would otherwise put Stripe's raw text in front of a fan
    // standing in a bar. Translate it, and stand the performer down so the tip
    // buttons disappear until they re-onboard rather than failing on every tap.
    let pi;
    try {
      pi = await stripe("payment_intents", {
        amount: String(chargeCents),
        currency: "usd",
        application_fee_amount: String(stripeFeeCents),
        // Card + wallets (Apple Pay / Google Pay ride the card rails) only.
        // allow_redirects: never removes redirect-based methods, so the client's
        // confirmPayment (redirect: 'if_required', no return_url) is correct by
        // construction and can never throw at confirm time.
        "automatic_payment_methods[enabled]": "true",
        "automatic_payment_methods[allow_redirects]": "never",
        "transfer_data[destination]": artist.stripe_account_id,
        "statement_descriptor_suffix": "TIP",
        "metadata[artist_id]": artist_id,
        "metadata[song_title]": song_title || "",
        "metadata[song_artist]": song_artist || "",
        "metadata[requester_name]": requester_name || "Anonymous",
        // metadata[tip] is what the PERFORMER earned, which is what the queue and the
        // recap should show. It is not what the fan was charged when they covered fees.
        "metadata[tip]": String(dollars),
        "metadata[stripe_fee_cents]": String(stripeFeeCents),
        "metadata[charged_cents]": String(chargeCents),
        "metadata[fees_covered]": coverFees ? "1" : "0",
      });
    } catch (piErr) {
      // Branch on the error CODE. Stripe documents no mapping from this scenario
      // to a status or a message, and the string people quote for a cross-mode
      // account is not in the docs at all, so text matching is only a last-ditch
      // fallback here, never the primary signal.
      const code = (piErr as { code?: string })?.code;
      const msg = String((piErr as Error)?.message || "");
      const deadDestination =
        code === "resource_missing" ||
        code === "livemode_mismatch" ||
        code === "account_invalid" ||
        /No such destination|No such account/i.test(msg);
      if (deadDestination) {
        console.log("Dead destination for artist " + artist_id + ": [" + code + "] " + msg);
        await admin.from("artists")
          .update({ stripe_onboarded: false }).eq("id", artist.id);
        await admin.from("artist_settings")
          .update({ stripe_charges_enabled: false }).eq("artist_id", artist_id);
        throw new Error("This performer isn't set up for in-app tips yet");
      }
      throw piErr;
    }

    return new Response(JSON.stringify({
      client_secret: pi.client_secret,
      publishable_key: STRIPE_PUBLISHABLE_KEY,
      // The server is the authority on money. The client displays these, it does not
      // compute them, so the total shown always matches the total charged.
      charged_cents: chargeCents,
      performer_gets_cents: chargeCents - stripeFeeCents,
      fees_covered: coverFees,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
