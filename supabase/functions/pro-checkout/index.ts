import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// LiveQue Pro subscription checkout. Stripe BILLING, the platform's own
// revenue - a completely separate money graph from the Connect tip path.
// Tips are direct charges on the performer's account and never touch this.
// Prices are inline price_data so no dashboard product setup is required.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CANONICAL = "https://getliveque.com";
const ALLOWED_ORIGINS = new Set([
  "https://getliveque.com",
  "https://www.getliveque.com",
]);

function returnBase(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.has(origin) ? origin : CANONICAL;
}

async function stripe(path: string, params: URLSearchParams) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe error");
  return data;
}

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
      .select("id, name, email")
      .eq("auth_user_id", user.id)
      .single();
    if (artistErr || !artist) throw new Error("Artist profile not found");

    let plan = "monthly";
    try {
      const body = await req.json();
      if (body && body.plan === "annual") plan = "annual";
    } catch (_) { /* default monthly */ }

    const base = returnBase(req);
    const params = new URLSearchParams({
      mode: "subscription",
      client_reference_id: artist.id,
      success_url: base + "/index.html?pro=done&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: base + "/index.html?pro=cancel",
      "metadata[artist_id]": artist.id,
      "subscription_data[metadata][artist_id]": artist.id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": "LiveQue Pro",
      "line_items[0][price_data][product_data][description]":
        "Earning tools for performers. 0% of tips, forever.",
    });
    if (plan === "annual") {
      params.set("line_items[0][price_data][unit_amount]", "3900");
      params.set("line_items[0][price_data][recurring][interval]", "year");
    } else {
      params.set("line_items[0][price_data][unit_amount]", "499");
      params.set("line_items[0][price_data][recurring][interval]", "month");
    }
    const email = artist.email || user.email;
    if (email) params.set("customer_email", email);

    const session = await stripe("checkout/sessions", params);
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
