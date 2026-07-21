# LiveQue — Kickoff & Reference

*The canonical "what is this, how does it work, where does it stand" document.
Written to bring anyone — a new collaborator, a future you, an advisor — fully up
to speed. Last updated 21 July 2026.*

---

## 1. The one-sentence version

**LiveQue connects the room to the stage: a fan at a live gig scans a QR code,
requests a song from the musician's own list, and tips them from their phone —
the money lands in the musician's bank, and LiveQue takes 0%.**

The domain is **getliveque.com**.

---

## 2. Who built it

Two brothers who gig:

- **Isaac Irvin** — isaacirvin@gmail.com · @isaacirvin · Los Angeles, CA. Owns the
  platform (Stripe, Supabase, domain) and does the build.
- **Glen Irvin** — glenirvin@gmail.com · @irvspanish. Plays live and is the first
  performer on it. Performs as **"Glen Irvin Jr."** and with the band **"The
  Smashing 90's."**

LiveQue is **not an LLC**. Isaac operates as an **unregistered sole proprietor**.
That single fact shapes a lot of the risk decisions below — read §8 carefully.

---

## 3. The problem, in their own words

You're playing a bar. Somebody in the room wants to hear a song and would happily
buy you a drink for playing it — but they have no way to tell you, and half of them
say *"sorry, I don't have cash."* The tip jar is empty not because nobody wants to
give, but because nobody carries cash anymore.

LiveQue is the bridge: the crowd can ask for a song and pay the musician, from the
phone already in their hand, without installing anything.

---

## 4. How it works

### The performer
1. Signs up at getliveque.com and builds a **song list** — the menu. Fans can only
   request songs the performer actually plays, killing *"sorry, I don't know that
   one."*
2. Taps **Start Gig**. Their fan page goes **LIVE**.
3. Puts their link (or a printed QR card) on the table.
4. Requests land silently on their phone. Tipped requests sit at the top with the
   amount shown. The performer plays what they want, skips what they don't — a tip
   moves a song **up the list**, it never forces a song onto the stage.
5. Money goes to the performer's **own** connected account and out to their bank on
   their normal schedule.

### The fan
1. Scans the QR / opens the shared link → the performer's page opens in the browser.
   No app, no account.
2. Picks a song. Requests it **free**, or **with a tip**.
3. Pays. Done.

### The song-request-to-queue mechanic
The core product feature is **a tip moves your song up the queue**. That requires
the app to *know a payment happened* — which is why the payment rail matters so much
(see §6 and §9).

---

## 5. Architecture & tech stack

Deliberately simple. No framework, no build step, one file per surface.

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, one file per surface |
| Hosting | Netlify static hosting, custom domain getliveque.com |
| Backend | Supabase — Postgres + Auth + Realtime + Edge Functions (Deno) |
| Payments | Stripe Connect (destination charges) |
| Email | Resend (transactional + gig recaps) |

**Supabase project ref: `jttswydixqeyyqvcohnq`** (name: SetQue / setque-live, **Pro**
tier). Not to be confused with any other project.

**Stripe account: `acct_1IMP9lEFvQmVBV5I`**, live publishable key `pk_live_51IMP9l…`.

### Public surfaces (files)
- **index.html** — the front door. Landing page + performer dashboard in one file;
  the landing lives inside `#loginOverlay`. Currently **v6.9.50**.
- **customer.html** — the fan-facing page. Requires `?artist=<uuid>` or it wipes
  itself to "Invalid link." Gates tip buttons on performer readiness.
- **terms.html / privacy.html** — legal, live.
- **help.html / handbook.html** — performer guides.
- **changelog.html** — version history, written for performers not developers.
- **assets/** — share.png (OG image), favicon set.

### Edge functions (Supabase, Deno/TypeScript)
- **stripe-create-tip** — creates the PaymentIntent. The money math lives here.
- **stripe-webhook** — receives Stripe events, fulfils them (queues the song,
  handles disputes, syncs performer readiness).
- **stripe-status** — reads a performer's Stripe state and mirrors readiness.
- **stripe-onboard** — creates/refreshes the performer's Stripe onboarding link.
- **liveque-email** — transactional mail via Resend.
- **gig-recap-sweeper** — post-gig recap emails.
- **import-spotify** — bulk song import.

---

## 6. The money model — the most important section

LiveQue uses **Stripe Connect destination charges** with **Express** connected
accounts, and takes **0%**.

### How a tip flows
1. Fan pays. The charge is created on **LiveQue's** platform account with
   `transfer_data[destination]` pointing at the performer's connected account.
2. `application_fee_amount` is set to **exactly Stripe's processing fee**, so the
   platform nets **zero** and the performer receives the published amount.
3. The fee formula: `round(charge * 0.029) + 30` cents. Verified against the
   published ledger: **$5 tip → $0.45 fee → performer gets $4.55**; **$2 tip →
   $0.36 fee → performer gets $1.64.**

### Why this matters (the trap that was fixed)
On destination charges, Stripe transfers the **full** charge to the performer and
debits the **platform** for its fee. Without an `application_fee_amount`, LiveQue was
silently paying $0.45 out of pocket on every $5 tip while advertising 0%. That's now
corrected — the fee is passed through so the ledger is true.

### The "cover the fees" option
There's a built (but currently **disabled**, `COVER_FEES_ENABLED = false`) toggle
that lets the *fan* cover Stripe's cut so the performer nets the full round number.
Grossed up as `charge = (tip + 30) / 0.971`, ceilinged so the performer is never a
cent short.

### The flat fee is the real enemy at this size
30¢ fixed on a $2 tip is **18%**. The percentage barely matters; the flat fee
dominates. The only processor that materially beats it is **PayPal micropayments**
(9¢ flat) — see §9.

---

## 7. Current state (21 July 2026)

**The app is LIVE in production and in use.** This is not a prototype.

### What's on right now
- **Free song requests** — fully working, need no Stripe, no approval.
- **Tipping via the performer's own handles** — Venmo, PayPal, Cash App, Apple Cash.
  These send money straight to the performer, outside LiveQue, so LiveQue never
  sees them and they **don't** move a song up the queue.
- **In-app card tipping is OFF** — `STRIPE_TIPS_ENABLED = false` in customer.html.
  Stripe is still being reviewed and the app is on **test** keys, so a card tapped
  in-app would move no real money. Turning it off is the honest state.

### Performers on the platform
- Glen Irvin Jr. — 175 songs
- The Smashing 90's — 63 songs
- Isaac D Irvin — 42 songs
- Marc Gordon — 0 songs

### Stripe account
- **Submitted and under review** (~2–3 day standard review).
- Verified on **Isaac's SSN** as an **unregistered business / sole proprietorship**.
  The old **"Vennew" EIN** from a killed 6-year-old venture was removed so nothing
  ties to it. (A legacy "VENNEW" *display* name still lingers in one settings field;
  it's not customer-facing and gets renamed to LiveQue once the review clears.)
- Statement descriptor set to **LIVEQUE**.
- Bank: Wells Fargo, on file.

### Go-live prep already done (dashboard, no code)
- Payment method domains registered: **getliveque.com** and **www.getliveque.com**.
- **Two webhook endpoints** created, both pointing at the `stripe-webhook` function:
  1. *Your account* scope → `payment_intent.succeeded`, `charge.dispute.created`
  2. *Connected accounts* scope → `account.updated`

### Staged but NOT deployed (frozen during a live gig)
- `stripe-webhook` now accepts **two** signing secrets (one per endpoint) — needed
  because each endpoint signs with its own `whsec_`.
- `golive.sh` updated to prompt for and set both webhook secrets.

---

## 8. Risk & liability — read before going live

Because LiveQue uses **destination charges** with **Express** accounts, and Isaac
has **no LLC**, three exposures land on Isaac *personally*:

1. **Chargebacks hit the platform.** A disputed $5 tip costs the platform the $5
   **plus a ~$15 dispute fee**, against 0% revenue. `stripe-webhook` claws the money
   back from the performer's balance — but only if they still have one.
2. **Negative balances are the platform's.** Standard Express-account behavior.
3. **Platform KYC is unavoidable.** No charge-type or account-type dodge exists;
   Stripe verifies whoever is in the money path.

**The escape hatch, if this ever matters more:** switch Express → **Standard**
accounts with **direct charges**. That moves merchant-of-record, disputes, refunds,
and negative-balance liability onto the *performer*, and Stripe (not the platform)
covers unrecoverable negatives. Cost: **every performer re-onboards** (Stripe won't
convert an account's type), and the statement descriptor becomes the performer's
name rather than a consistent "LIVEQUE" (a chargeback-driver at micro amounts).
Recommendation on file: **stay on destination charges for now**; revisit Standard
only if dispute volume or personal-liability concern grows.

The Connect Platform Agreement is harsher than the developer docs (uncapped,
"jointly and severally liable" except for Stripe-Managed-Risk accounts). Worth a
written confirmation from Stripe before any migration.

---

## 9. Payment-rail research (settled)

Extensive research went into "can we get out of the money path / go cheaper." The
conclusions:

- **You cannot avoid being a platform** if money flows through the app. KYC applies.
- **Cheapest at $2:** PayPal **micropayments** (4.99% + **9¢** ≈ 9.5%) vs Stripe's
  2.9% + 30¢ (≈ 18%). Reachable via **Ko-fi** with no partner status.
- **Out of the money path entirely, and queue-priority still works:** Square
  (`PAYMENTS_READ` + `ORDERS_READ`, no app review) or **Ko-fi** (creator-configured
  webhooks, LiveQue holds *zero* credentials). Neither is cheaper than Stripe.
- **Dead ends:** Venmo/Cash App/Zelle (no observation API + ToS bars the use),
  Adyen (enterprise-only), Mollie/Zettle (no US), Revolut (no US sole proprietors),
  Connect OAuth read-only (closed to new apps).
- **The one genuine economic win with no migration:** help performers onto **PayPal
  micropayments pricing** on their own accounts.

Full detail lives in the research the team ran; this is the summary.

---

## 10. Going live (the runbook)

Ordered, because the order has named failure modes. Full detail in
`docs/GOLIVE.md`. Short version:

1. **Business verification clears** (the 2–3 day review). *← currently here.*
2. **Complete the Connect platform profile** — two liability acknowledgements
   (refunds/chargebacks + ongoing seller compliance). Isaac's signature.
3. **Payment method domains** — done.
4. **Two webhook endpoints** — done.
5. **Re-onboard performers on live keys** — test `acct_` IDs die on the key swap.
   This is the long pole; `stripe-onboard`/`stripe-status` now self-heal a dead
   account instead of erroring.
6. **Swap the webhook secrets first** (both of them), then **both API keys
   together**. `golive.sh` does this with the keys never leaving the machine.
7. **Flip `STRIPE_TIPS_ENABLED = true`** and deploy.
8. **One real low-value charge, off-peak**, and confirm all five: PI succeeds →
   song queues (webhook) → transfer lands → platform nets ~zero → wallet buttons
   render on a real iPhone.

Rollback is config-only: put the three test secrets back.

---

## 11. Legal & compliance

- **Terms of Service** and **Privacy Policy** are live, using Stripe's prescribed
  Connected Account Agreement language, a clickwrap agree-box at signup, a fee-change
  clause with 30-day notice, and a real refund policy (60-day window, defined cases).
- Contact is **getliveque@gmail.com** (the domain has no MX records, so
  support@getliveque.com bounces — a Namecheap email-forward would fix that).
- **Tips are framed as payment for a service performed** — Stripe permits tips
  "given for a good or service" and bars peer-to-peer money transmission; the site
  now says this explicitly.
- Still to file when there's time: source-code **copyright** ($65, the one you can't
  sue without), **trademark** ($350), **DMCA agent** ($6).

---

## 12. Design language (so it stays consistent)

- Ground **#080808**, teal accent **#4ECDC4 / #4ecdc4**, **Inter** for print.
- Business cards printed on **18pt Colorplan Ebony** (dyed-through black stock so
  the cut edge stays black), full-color + white ink both sides, real error-correction-H
  QR verified by decoding it back off the rendered art.
- The share image and favicon reuse the card's language so everything reads as one
  system.

---

## 13. Open items (as of this doc)

- ⏳ **Stripe review** to clear (2–3 days) — nothing to do but wait.
- ☐ **Two Connect liability acknowledgements** — Isaac's click, needed for go-live.
- ☐ **Rename the lingering "VENNEW" display name → LiveQue** — after review clears.
- ☐ **Deploy the staged webhook dual-secret fix** at go-live.
- ☐ **Re-onboard performers** on live keys at go-live.
- ☐ **Namecheap email forwarding** for a working support@ address.
- ☐ **Legal filings** ($421 total) when there's time.
- ☐ Decide, deliberately: **stay on destination charges** vs migrate to Standard
  (liability vs friction — see §8).

---

*This document is the map. The territory is the live site, the Stripe dashboard,
and the code — when they disagree with this doc, they win, and this doc should be
updated.*
