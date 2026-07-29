import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Syncs LiveQue Pro subscription state from Stripe into artist_settings.
// Webhook-free by design: truth is pulled on demand - once when checkout
// returns (body.session_id), and again whenever the dashboard loads with a
// lapsed pro_period_end. For a two-person platform this is simpler and
// harder to break than webhook plumbing; the worst case is a cancelled
// subscriber keeping Pro until their already-paid period ends, which is
// exactly what they paid for. Also mints billing-portal links (body.portal)
// so subscribers can cancel themselves.

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

async function stripeGet(path: string) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe error");
  return data;
}

async function stripePost(path: string, params: URLSearchParams) {
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
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    if (artistErr || !artist) throw new Error("Artist profile not found");

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* plain status check */ }

    const { data: settings } = await admin
      .from("artist_settings")
      .select("pro_active, pro_plan, pro_customer_id, pro_subscription_id, pro_period_end, pro_gift, pro_gift_until, founding")
      .eq("artist_id", artist.id)
      .single();

    // Billing portal link for self-serve cancel/card update.
    if (body && body.portal === true) {
      if (!settings?.pro_customer_id) throw new Error("No subscription on file");
      const portal = await stripePost("billing_portal/sessions", new URLSearchParams({
        customer: settings.pro_customer_id as string,
        return_url: returnBase(req) + "/index.html",
      }));
      return new Response(JSON.stringify({ url: portal.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subId = settings?.pro_subscription_id as string | null;
    let customerId = settings?.pro_customer_id as string | null;

    // Fresh checkout return: resolve the session to its subscription.
    if (body && typeof body.session_id === "string" && body.session_id.startsWith("cs_")) {
      const session = await stripeGet("checkout/sessions/" + body.session_id);
      // The session must belong to this performer - client_reference_id was
      // set at creation, so a pasted foreign session id syncs nothing.
      if (session.client_reference_id === artist.id) {
        if (typeof session.subscription === "string") subId = session.subscription;
        if (typeof session.customer === "string") customerId = session.customer;
      }
    }

    let active = settings?.pro_active === true, plan: string | null = settings?.pro_plan as string | null, periodEnd: string | null = settings?.pro_period_end as string | null;
    if (subId) {
      let sub: Record<string, unknown> | null = null;
      try { sub = await stripeGet("subscriptions/" + subId); } catch (_) { sub = null; }
      if (sub) {
        active = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
        plan = (sub as any).items?.data?.[0]?.price?.recurring?.interval === "year" ? "annual" : "monthly";
        // Newer Stripe API versions moved current_period_end onto the item.
        const pe = (sub as any).current_period_end || (sub as any).items?.data?.[0]?.current_period_end;
        periodEnd = pe ? new Date(pe * 1000).toISOString() : null;
        if (typeof (sub as any).customer === "string") customerId = (sub as any).customer;
        // Subscription columns only - gift columns are a separate rail and
        // are never written here, so a lapsed sub can't erase a gift.
        await admin.from("artist_settings").upsert({
          artist_id: artist.id,
          pro_active: active,
          pro_plan: plan,
          pro_customer_id: customerId,
          pro_subscription_id: subId,
          pro_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const giftValid = settings?.pro_gift === true &&
      (!settings?.pro_gift_until || new Date(settings.pro_gift_until as string) > new Date());
    return new Response(JSON.stringify({
      pro_active: active || giftValid,
      pro_paid: active,
      pro_gift: giftValid,
      pro_plan: active ? plan : (giftValid ? "gift" : plan),
      pro_period_end: periodEnd,
      founding: settings?.founding !== false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
