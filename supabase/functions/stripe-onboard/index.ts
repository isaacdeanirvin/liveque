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

const CANONICAL = "https://getliveque.com";
const ALLOWED_ORIGINS = new Set([
  "https://getliveque.com",
  "https://www.getliveque.com",
]);

/** Send the performer back to the SAME origin they started from.
 *
 * These URLs used to be hardcoded to the old soft-nasturtium-c51aac.netlify.app
 * subdomain, which still serves the app on a 200 rather than redirecting. A
 * Supabase session lives in one origin's localStorage, so returning someone to a
 * different host drops them on a LOGGED OUT copy: onboarding completes at Stripe,
 * the dashboard never calls stripe-status, and readiness never syncs. That is the
 * "finished Stripe but still can't take tips" bug.
 *
 * Allowlisted rather than reflected, so it cannot be turned into an open redirect
 * by a forged Origin header.
 */
function returnBase(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.has(origin) ? origin : CANONICAL;
}

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

/** Does this connected account exist under the key we are currently running on?
 *
 * A connected account only exists in the mode that created it, so every stored
 * acct_ goes dead the moment test keys are swapped for live ones.
 */
async function accountExists(id: string): Promise<boolean> {
  const res = await fetch("https://api.stripe.com/v1/accounts/" + id, {
    headers: { "Authorization": "Bearer " + STRIPE_SECRET_KEY },
  });
  if (res.ok) return true;
  const body = await res.json().catch(() => ({}));
  const code = body?.error?.code;
  // Stripe does not document which error a cross-mode account id produces. Both
  // resource_missing and livemode_mismatch are plausible, and the runtime string
  // people quote for this ("a similar object exists in test mode") appears
  // nowhere in the official docs, so it is not safe to match on text. Accept
  // either code, or a bare 404, as "absent in this mode".
  if (res.status === 404 || code === "resource_missing" || code === "livemode_mismatch") {
    return false;
  }
  // 401/403 mean the key is wrong or the account belongs to another platform.
  // Treating those as "missing" would mint a duplicate and orphan the original,
  // so fail loudly instead.
  throw new Error(body?.error?.message || "Stripe error");
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
      .select("id, name, email, stripe_account_id")
      .eq("auth_user_id", user.id)
      .single();
    if (artistErr || !artist) throw new Error("Artist profile not found");

    let accountId = artist.stripe_account_id;

    // Recover from a mode switch. Without this, account_links is called with a
    // dead test id, Stripe hard-errors, and the performer can never re-onboard —
    // which would make the test-to-live cutover impossible to complete, since
    // re-onboarding is the one step every performer has to do themselves.
    if (accountId && !(await accountExists(accountId))) {
      console.log("Stale account " + accountId + " absent in this mode, recreating");
      accountId = null;
      await admin.from("artists")
        .update({ stripe_account_id: null, stripe_onboarded: false })
        .eq("id", artist.id);
      await admin.from("artist_settings")
        .update({ stripe_charges_enabled: false })
        .eq("artist_id", artist.id);
    }

    if (!accountId) {
      const acctParams: Record<string, string> = {
        type: "express",
        country: "US",
        business_type: "individual",
        "capabilities[transfers][requested]": "true",
        "business_profile[product_description]": "Live music tips received via LiveQue",
      };
      const email = artist.email || user.email;
      if (email) acctParams.email = email;
      const acct = await stripe("accounts", acctParams);
      accountId = acct.id;
      await admin.from("artists").update({ stripe_account_id: accountId }).eq("id", artist.id);
    }

    const base = returnBase(req);
    const link = await stripe("account_links", {
      account: accountId,
      refresh_url: base + "/index.html?stripe=refresh",
      return_url: base + "/index.html?stripe=done",
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: link.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});