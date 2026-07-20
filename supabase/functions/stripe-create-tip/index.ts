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
  if (!res.ok) throw new Error(data.error?.message || "Stripe error");
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { artist_id, amount, song_title, song_artist, requester_name } = body;

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
      .select("tip_amounts")
      .eq("artist_id", artist_id)
      .single();
    const allowed = Array.isArray(settings?.tip_amounts)
      ? settings.tip_amounts.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    if (allowed.length && !allowed.includes(dollars)) {
      throw new Error("Invalid tip amount");
    }

    const pi = await stripe("payment_intents", {
      amount: String(dollars * 100),
      currency: "usd",
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
      "metadata[tip]": String(dollars),
    });

    return new Response(JSON.stringify({
      client_secret: pi.client_secret,
      publishable_key: STRIPE_PUBLISHABLE_KEY,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
