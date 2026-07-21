# Going live: test mode to real money

Every step below is sourced from Stripe's own current docs. Do them **in this
order**. The order is not stylistic; violating it has specific, named failure
modes, listed at the bottom.

Run `./scripts/preflight.sh` before you start and after every step.

---

## The one thing to understand before anything else

**Test connected accounts do not exist in live mode.**

> "Each mode has its own set of API keys, and objects in one mode aren't
> accessible to the other."
> — <https://docs.stripe.com/keys>

> "Test connected accounts can't receive or send real money and can't be used in
> live mode."
> — <https://docs.stripe.com/treasury/connect/account-management/connected-accounts>

Every `acct_...` ID currently in the `artists` table is **dead** the moment you
switch keys. Glen, Isaac, everyone re-onboards from scratch and gets a **new,
different** account ID.

This is the long pole. Start it early. Steps 1 to 5 can all run while test mode
keeps serving gigs.

---

## Step 1 — Activate the platform account

Complete business verification in the Stripe Dashboard. Live keys do not work
until this clears and it can take days.

> "To use Stripe services outside of a sandbox, you must verify your business."
> — <https://docs.stripe.com/get-started/account/activate>

One irreversible detail on that page: after activation you **cannot change the
business origin country**.

Checked in the live dashboard 2026-07-21 — most of this is already filled in.
Outstanding: **Business details**, **Verification document**, **Add your bank**,
Secure your account, Add extras, **Review and submit**.

---

## Step 1b — Complete the CONNECT PLATFORM PROFILE

Separate from Step 1, separately incomplete, and easy to miss because the
activation checklist does not mention it. Settings → Connect → Platform profile
currently reads **"Onboarding incomplete"**, with two outstanding items:

- Refunds and chargebacks liability acknowledgement
- Ongoing seller compliance acknowledgement

Read the first one rather than clicking through it. It is the legal counterpart
to the exposure in the last section of this document: on destination charges
Stripe debits the **platform** for disputes, and at 0% margin one $5 chargeback
puts LiveQue negative by $5 plus the dispute fee. `stripe-webhook` reverses the
transfer to claw it back, but only while the performer still has a balance.

---

## Step 2 — Ship the livemode guard  ✅ DONE

Already deployed. Documented here because it must stay.

A live webhook endpoint receives **test** events as well as live ones:

> "your development webhook URLs receive only test webhooks, but your production
> webhook URLs receive both live and test webhooks... We recommend that you check
> the `livemode` value."
> — <https://docs.stripe.com/connect/webhooks>

Without it, anyone who can trigger a test payment causes real fulfilment in
production: a song queued, a tip counted, a recap emailed. `stripe-webhook` now
compares `event.livemode` against whether `STRIPE_SECRET_KEY` starts with
`sk_live_`, and no-ops with a 2xx on mismatch.

---

## Step 3 — Register the payment method domains in LIVE mode

This is what makes Apple Pay and Google Pay appear. It is **not** a missing file.

**Ignore any guide telling you to host
`/.well-known/apple-developer-merchantid-domain-association`, create an Apple
Merchant ID, or generate a CSR.** Stripe's current docs say explicitly not to:

> "Stripe handles Apple merchant validation for you, including creating an Apple
> Merchant ID and Certificate Signing Request. Don't follow the merchant
> validation process in the Apple Pay documentation."
> — <https://docs.stripe.com/apple-pay?platform=web>

A 404 on that path is expected and harmless.

**Do this instead.** Dashboard → Settings → Payment method domains → *Add a new
domain*. Register **both**:

- `getliveque.com`
- `www.getliveque.com` — "`www` is a subdomain that you must also register"

Do it in **live** mode explicitly and confirm both appear. Stripe's docs
contradict each other on whether live registration propagates down to sandboxes,
so do not rely on inheritance in either direction.

Because LiveQue uses **destination charges**, the platform registers once and
that is all:

> "If the platform creates destination charges or separate charges and transfers,
> use your platform's secret key... and omit the Stripe-Account header."
> — <https://docs.stripe.com/payments/payment-methods/pmd-registration>

You do **not** register on behalf of each performer. That is a direct-charges
requirement only.

### If the wallet still does not show

In rough order of likelihood: domain not registered in the mode you are testing;
`www` missing; no card in the device wallet; incognito or private browsing;
browser wallet-check permission disabled; non-biometric hardware for Apple Pay.

Testing gotcha: **Stripe test cards cannot be added to an Apple Pay wallet.** Use
a real card with test API keys. Stripe recognises the situation and returns a
test token.

---

## Step 4 — Create the LIVE webhook endpoints

Two of them.

**a) Account endpoint** — same Supabase function URL, subscribed to:
- `payment_intent.succeeded`
- `charge.dispute.created`

**b) Connected accounts endpoint** — same URL, but scoped to connected accounts,
subscribed to:
- `account.updated`

That second one is new and it fixes a real recurring problem. Until now the only
thing that set `stripe_charges_enabled` was a performer opening their dashboard,
which is why someone can finish Stripe onboarding, close the tab, and still have
no tip buttons at their next gig. `stripe-webhook` now handles `account.updated`
and syncs readiness the moment Stripe approves them. **It only fires on a
connected-accounts-scoped endpoint.** A normal endpoint will not deliver it.

Copy the **new** `whsec_...`. It is different from the test one:

> "Stripe generates a unique secret key for each endpoint. If you use the same
> endpoint for both test and live API keys, the secret is different for each one."
> — <https://docs.stripe.com/webhooks>

---

## Step 5 — Re-onboard every performer in live mode

New Account Links against live keys. New `acct_` IDs.

This used to be impossible. `stripe-onboard` reused the stored `acct_`, which is
dead under live keys, so `account_links` hard-errored and no performer could get
back in — on the one step nobody else can do for them. Both `stripe-onboard` and
`stripe-status` now detect an account that does not exist in the current mode,
clear it, and fall back to a fresh onboarding. The performer just taps **Set Up
Payouts** again.

Note on the detection: Stripe **does not document** which error a cross-mode
account id produces. `resource_missing` and `livemode_mismatch` are both
plausible and the runtime message everyone quotes for this
("a similar object exists in test mode") appears nowhere in the official docs.
The code accepts either code or a bare 404 and deliberately does **not** match on
message text.

### Do not add the `card_payments` capability

Tempting, because readiness is gated on `charges_enabled`. It is the wrong move.

`charges_enabled` is not card-specific:

> "`charges_enabled` confirms that your full charge path including the charge and
> transfer works correctly and evaluates if either `card_payments` or `transfers`
> capabilities are active."
> — <https://docs.stripe.com/connect/api-onboarding>

Either/or, so a transfers-only Express account reaches `charges_enabled: true`.
Destination charges need `transfers`, not `card_payments`:

> "Payments using the `transfers` capability include Destination charges and
> Separate charges and transfers."
> — <https://docs.stripe.com/connect/account-capabilities>

And requesting it carries real downside:

> "To reduce onboarding effort, only request the capabilities that your accounts
> need. Requesting more capabilities means the onboarding flow must verify more
> information."

> "If a connected account has both `card_payments` and `transfers`, and the
> `status` of either one is `inactive`, then both capabilities are disabled."

So a `card_payments` that fails verification would disable a working `transfers`.
Some capabilities are also permanent once requested, and Stripe never enumerates
which. Leave it alone.

The one thing that would change this: if LiveQue ever onboards a performer
outside the platform's region, `on_behalf_of` becomes mandatory, and that **does**
require `card_payments`.

Readiness therefore checks `charges_enabled && payouts_enabled &&
details_submitted`, plus `capabilities.transfers === "active"` where present —
because `charges_enabled` alone cannot distinguish which capability satisfied it,
and Stripe warns a capability can drop back out of active after go-live.

Each performer has their own KYC gate, and live mode is stricter than test.

---

## Step 6 — Swap `STRIPE_WEBHOOK_SECRET` first

```
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Before the API keys, not after. A live signing secret with no live traffic yet is
harmless. The reverse silently drops every live event.

---

## Step 7 — Swap both API keys together

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Both in one go. A `pk_live` client cannot confirm a PaymentIntent created with
`sk_test`.

No redeploy or Netlify build is needed. The publishable key reaches the browser
at runtime through `stripe-create-tip`, so this takes effect on the next edge
function cold start. That single indirection is what makes the switch a config
change rather than a release.

---

## Step 8 — One real charge, off-peak, not during a gig

Send a real low-value tip to a live-onboarded performer and confirm all five:

1. PaymentIntent succeeds
2. Webhook delivers 2xx and the song appears in the queue
3. Transfer lands on the performer
4. `application_fee_amount` roughly equals the Stripe fee, platform nets ~zero
5. Wallet buttons render on a real iPhone

Only then run a live gig.

---

## What breaks if you reorder

| Violation | Result |
|---|---|
| Live keys before the live webhook exists | Payments succeed, **money moves**, no event fires. Songs never queue. Tips taken with no fulfilment. Silent and customer-facing, the worst one. |
| Live keys before swapping the webhook secret | Signature verification fails against the test secret. Every delivery fails identically. Same visible symptom as above. |
| Live keys before performers re-onboard | `transfer_data[destination]` gets a dead test `acct_` ID. Hard API error, every payment fails. Loud and total, but recoverable. |
| Live keys before domains registered | Cards work, **Apple Pay and Google Pay silently vanish**. No error anywhere. Pure conversion loss you will not notice without a real device. |
| Live keys before platform activation | Keys rejected. Nothing works. |
| Deploying without the `livemode` guard | Test events trigger real fulfilment in production. |

**In-flight test data:** nothing migrates, nothing is lost. Test objects stay
viewable in the sandbox forever, they just become unreachable from live keys.
Settle any unfulfilled test payment **before** you flip, because afterwards the
code cannot see it.

---

## Rollback

1. **Revert the three secrets to their test values.** That is the whole rollback.
   Config only, no rebuild, effective on next cold start. Test keys are never
   revoked by going live, and a publishable key cannot expire.
2. **Disable the live webhook endpoint, do not delete it.** Deleting loses the
   secret and you get a new one on re-create.
3. **Disable rather than delete a misbehaving payment method domain.** Wallets
   disappear, card entry keeps working. You degrade instead of going dark.
4. **Refund live charges with `reverse_transfer=true`.** This matters enormously
   at zero margin: by default the connected account keeps the transferred funds
   and the **platform** covers the negative balance. Add
   `refund_application_fee=true` to also pull the fee back.

Rollback does not undo live onboarding, which is fine. Live `acct_` IDs stay
valid for the next attempt.

---

## Two open decisions, both about money

**1. The application fee is hardcoded to domestic US card pricing.**
`stripe-create-tip` computes `round(amount * 0.029) + 30`. Test-mode fees are
simulated; live fees are not. International cards, currency conversion and
card-type surcharges all cost more than the domestic baseline, and the platform
pays the Stripe fee after the application fee is transferred. So every
above-baseline card comes straight out of LiveQue's balance.

At small volume this is pennies. Decide deliberately whether to absorb it or add
a small buffer, because at zero margin there is nothing else to absorb it.

**2. Disputes hit the platform, and there is no buffer.**
On destination charges Stripe debits dispute amounts and fees from the
**platform** account, with or without `on_behalf_of`. One disputed tip puts
LiveQue negative by the amount plus the dispute fee. `stripe-webhook` already
reverses the transfer on `charge.dispute.created` to claw it back, but that only
works if the performer still has a balance.
