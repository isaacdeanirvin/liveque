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
    const dollars = Math.round(Number(amount));
    if (!dollars || dollars < 1 || dollars > 500) throw new Error("Invalid tip amount");

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

    const pi = await stripe("payment_intents", {
      amount: String(dollars * 100),
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      "transfer_data[destination]": artist.stripe_account_id,
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