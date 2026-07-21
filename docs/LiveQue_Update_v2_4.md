# LiveQue — Session Update v2.4
## Claude Code execution session — July 19, 2026
## Mission: make the in-app Stripe tip flow flawless on the audience side

This document is the starting context for the next session. It assumes the reader
knows nothing. Read it top to bottom before touching a file. It pairs with
[LiveQue_ClaudeCode_Kickoff_v1.md](LiveQue_ClaudeCode_Kickoff_v1.md), which is the
full architecture and the F1–F11 gap list this session worked from.

---

## 0. TL;DR

Eight of the eleven gap-list items are done, deployed, and verified:
**F1, F2, F4, F5, F6, F7, F8, F10**, plus **F9 confirmed by code review**. Every
change is committed to `main` (GitHub `isaacdeanirvin/liveque`) and live on Netlify
(`soft-nasturtium-c51aac.netlify.app`) and Supabase (`setque-live`).

What is **not** done, because it needs a human with a phone / a Stripe login:
**F3** (Apple Pay domain registration + wallet enablement + iPhone test),
**F11** (money verification in the Stripe dashboard), the **version bump to
v6.9.11**, the full **end-to-end card-payment test**, and the **Glen canary**.
Details in Section 5.

The files are in a shippable state. Nothing was left mid-surgery.

---

## 1. Environment notes discovered this session

- **RESOLVED 2026-07-20: the project is on Supabase PRO. Auto-pause no longer
  applies and this item is closed. Historical record below.**
- **The Supabase project had auto-paused.** Free-tier inactivity (last activity
  ~June 1) put project `jttswydixqeyyqvcohnq` to sleep, which removes its DNS
  record — so the live site (audience + admin) was silently dead until it was
  restored on July 19. **This will recur ~1 week after each idle stretch until the
  project is on Supabase Pro.** Worst case it dies the afternoon before a gig.
  Treat the Pro upgrade as higher priority than its parked position implies.
- **No Supabase backups / no migrations** are configured (dashboard shows "No
  backups", "No migrations"). All DDL this session was run by hand in the SQL
  editor and mirrored into `sql/`. Consider enabling PITR/backups (Pro).
- **All four Stripe Edge Function sources are now vendored into git** under
  `supabase/functions/` — they were never tracked before. `stripe-onboard` and
  `import-spotify` are still not vendored (not touched this session).
- **Onboarding status (test mode):** Isaac's artist (`b1ed9955…`) **is** Stripe-
  onboarded and can take tips. **Glen's artist (`f2c819fc…`) is NOT onboarded** —
  he cannot take in-app card tips until he finishes Stripe Connect. This is why F2
  matters for the canary.
- **Fee structure:** `stripe-create-tip` creates a **destination charge**
  (`transfer_data[destination]` = performer's connected account) with **no
  `application_fee_amount`** — so today **100% of the tip routes to the performer**
  and the platform (LiveQue) absorbs Stripe's processing fee. No platform cut yet.
  Changing this is a business decision; it was intentionally not touched.

---

## 2. What shipped, item by item

Order matches the kickoff's ordered plan. Each item lists what was wrong, the fix,
how it was verified, and the commit.

### F1 — Tip integrity (anon INSERT lockdown) — commit `7710544`
- **Was:** the kickoff flagged that the anon INSERT policy on `requests` did not
  constrain columns, so anyone with the page-source anon key could insert
  `tip_amount: 999` and jump the queue for free.
- **Found:** the policy already carried a `tip_amount`/`status` check (a crafted
  `tip_amount:50` insert was rejected before any change), so tip integrity was
  likely closed in the v6.9.7 lockdown. The migration re-asserts it cleanly and
  proves it.
- **Fix:** `sql/2026-07-19-tip-integrity.sql`. Anon INSERT policy is now
  `WITH CHECK (tip_amount = 0 AND status = 'queued')`. Dropped a redundant
  duplicate authenticated INSERT policy so `public.requests` has exactly three
  policies: `requests_performer_all` (authenticated, ALL, own-artist bridge),
  `anon_insert_free_queued_only` (anon, INSERT), `requests_anon_select` (anon,
  SELECT). Stripe's service-role webhook bypasses RLS, so real tips are unaffected.
- **Verified (live REST):** crafted anon inserts with `tip_amount:50`,
  `status:'playing'`, and `tip_amount:-5` all rejected (`42501`); anon UPDATE
  affects 0 rows. Free requests via the UI still work.

### F5 + F4 — Harden `stripe-create-tip` — commit `e9890de` (baseline `cfac573`)
- **F5 (amount validation):** replaced `Math.round(Number(amount))` — which
  silently turned `0.5` into a $1 charge — with `Number.isInteger` + range
  `1..500`, and added a **membership check** binding the amount to the performer's
  own configured `tip_amounts`. A forged invoke can no longer charge an arbitrary
  in-range value. Added `statement_descriptor_suffix: "TIP"`.
- **F4 (no redirect trap):** added
  `automatic_payment_methods[allow_redirects] = never`. Only card + wallets
  (Apple/Google Pay ride the card rails) are offered, so the client's
  `confirmPayment({ redirect: 'if_required' })` with no `return_url` is correct by
  construction and can never throw at confirm.
- **Verified (live function endpoint):** `0.5`, `3`, `4`, `0`, `-5`, `99999` all
  rejected with `400 Invalid tip amount`; a valid configured tip (`5`) for an
  onboarded artist still returns a `client_secret` — proving the new Stripe params
  are accepted. Deployed to `setque-live`.

### F6 — Paid-but-invisible (null gig session) — commit `2a1a966`
- **Was:** the audience queue loaded with `.eq('gig_session_id', currentGigSessionId)`,
  and PostgREST `.eq()` cannot match SQL NULL. On an account with no active gig
  (`current_gig_session_id = null`), a paid request (webhook inserts null session)
  never appeared on the audience screen even though money was taken.
- **Fix, two layers:** (1) `signUp()` in `index.html` now mints an active gig
  session in the `artist_settings` insert instead of `null`, so no new account is
  ever null. (2) `loadFromSupabase()` in `customer.html` falls back to
  `.is('gig_session_id', null)` when the session is null, so existing null-session
  accounts still display.
- **Webhook intentionally unchanged.** It inserts the artist's current session
  (null or not); the realtime handlers already compare sessions with a null-safe
  `!==`. Minting in the webhook would desync the live audience (whose session is
  still null) and reject the very payment that triggered it.
- **Verified:** REST proof — old `gig_session_id=eq.null` returns `[]`, new
  `gig_session_id=is.null` returns Isaac's two null-session rows; and the live
  audience page now renders those two requests where it previously showed empty.

### F2 — Gate tip buttons on Stripe readiness — commits `89cd3a0`, `3505136`, `9f1c1ec`, `f513330`
- **Was:** the audience page rendered paid tip buttons for every performer. For a
  performer who never finished onboarding (Glen), `stripe-create-tip` rejects the
  tip and the audience hits an error mid-payment.
- **Fix:** added an anon-readable boolean `artist_settings.stripe_charges_enabled`
  (`sql/2026-07-19-stripe-readiness-flag.sql`), backfilled from
  `artists.stripe_onboarded`. `stripe-status` now mirrors readiness onto that flag
  on every status check. `customer.html` reads it in `loadFromSupabase()` and only
  renders tip buttons when true; otherwise the audience gets the free-request button
  plus the existing external tip-jar links. No error states.
- **Verified (live, headless):** Glen (`false`) → 0 tip buttons + free button;
  Isaac (`true`) → 3 tip buttons ($2/$5/$10) + free button.

### F8 — Escape user strings at innerHTML render sites — commit `61bd52a`
- **Was:** `requester_name` (audience-typed) and `song_title`/`song_artist`
  (settable via crafted anon inserts) were concatenated raw into `innerHTML` on the
  performer's authenticated dashboard and every audience phone. No escaping helper
  existed.
- **Fix:** added an `escapeHTML()` helper to both files and applied it at every
  render site (admin live queue; audience now-playing / up-next / queue / request
  modal; song-library and Spotify-import lists). Toasts already use `textContent`
  and were left alone.
- **Verified (live, headless):** a request whose title/name is
  `<img src=x onerror=…>` / `<b>…</b>` renders as inert **escaped literal text** —
  no script fires, no element injected. `node --check` passes on both files.

### F7 — Post-payment pending state — commit `f8a12cc`
- **Was:** on `succeeded`, `confirmTipPayment` instantly claimed "your request is in
  the queue" and closed the modal, but the row arrives 1–5s later via
  webhook → insert → realtime. On slow venue wifi the audience stared at a queue
  without their song.
- **Fix:** on success the modal now shows "Locking in your request…" and holds a
  `pendingTip` state. `handleRequestInsert` resolves it and celebrates the moment
  the matching row (same song title + requester + tip>0) arrives. Timeboxed to 10s
  with a reassuring fallback ("tip received — your request will appear shortly"),
  never implying failure (the webhook's retry + idempotency guarantee delivery).
- **Verified (live, headless):** matching row → pending cleared, modal closed, row
  in queue; a non-matching insert leaves the pending state intact.

### F10 — Strip debug logs — commit `783f44e`
- Removed 32 debug `console.log` from `customer.html` and 2 from `index.html`
  (session ids, payment methods, social handles, realtime channel chatter, HANDLER
  traces). Kept the single version banner per file and genuine `console.error`
  diagnostics. `node --check` passes on both.

### F9 — Error-state polish — verified by review (no code change needed)
`confirmTipPayment` already handles the three cases correctly: card decline → red
inline message + re-armed Pay button; double-submit → button disabled on entry;
`processing` status → yellow "Payment processing…". Live decline (`4000 0000 0000
9995`) and 3DS (`4000 0027 6000 3184`) card checks are folded into the E2E pass
(Section 5) because they require entering a real card number.

---

## 3. SQL run this session (mirrored in `sql/`)

1. `sql/2026-07-19-tip-integrity.sql` (F1) — anon INSERT `WITH CHECK
   (tip_amount = 0 AND status = 'queued')`; drop redundant policy; final state = 3
   policies on `public.requests`.
2. `sql/2026-07-19-stripe-readiness-flag.sql` (F2) — add
   `artist_settings.stripe_charges_enabled boolean not null default false`;
   backfill from `artists.stripe_onboarded` (Isaac true, Glen false).

Both were run in the Supabase SQL editor against `setque-live` (role `postgres`)
and verified.

## 4. Edge Functions changed / deployed

- `stripe-create-tip` — hardened (F5/F4), **deployed**. Source vendored at
  `supabase/functions/stripe-create-tip/index.ts`.
- `stripe-status` — now syncs `stripe_charges_enabled` (F2), **deployed**. Source
  vendored at `supabase/functions/stripe-status/index.ts`.
- `stripe-webhook` — **unchanged**, vendored for the record at
  `supabase/functions/stripe-webhook/index.ts`.
- Edge deploys **cannot be auto-rolled-back**; the pre-change source of each edited
  function is preserved as its own "baseline" commit if a manual revert is needed.

---

## 5. What is NOT done — the remaining gates (need a human / a phone / a Stripe login)

Work strictly through these to finish the mission.

1. **F3 — wallets + Apple Pay domain (Stripe dashboard + iPhone).** The client code
   is already correct (F4 offers card + Apple/Google Pay only). Remaining, all in
   the Stripe dashboard which the automation browser is **not** logged into:
   - Register the Apple Pay domain `soft-nasturtium-c51aac.netlify.app` under
     **Settings → Payment method domains**.
   - Confirm **Apple Pay** and **Google Pay** are enabled under payment methods
     (test mode).
   - Test on a real **iPhone (Safari)**: the Apple Pay button should appear above
     the card form and a test-mode wallet payment should complete.
   - When DNS moves to `getliveque.com`, the Apple Pay domain must be re-registered
     for that domain.
2. **Full end-to-end card test** on the live URL (kickoff Section 7 scenarios 1–4,
   7): free request, $5 success (`4242…`), decline (`4000…9995`) then retry, 3DS
   (`4000…0027…3184`), and a fresh/null-session tip appearing on both surfaces.
   Requires entering a card number, so this is a human step.
3. **F11 — money verification** in the Stripe dashboard: confirm the PaymentIntent
   succeeded, funds land on the connected account (destination charge — see Section
   1), and the `stripe-webhook` delivery log shows 200s.
4. **Version bump to v6.9.11.** Update the console banner in both files and the
   help-modal footer in `index.html`. Currently `customer.html` = v6.9.10,
   `index.html` = v6.9.9. Do this **after** the E2E passes so the shipped version
   means "verified."
5. **Glen canary.** Glen (or his new band account, once onboarded) runs a real
   test-mode tip from his own phone. The mission is complete only after this.

---

## 6. Known issues / deferred (nothing silently disappears)

- ~~**Supabase free-tier auto-pause will recur**~~ CLOSED 2026-07-20, account is on
  Pro. Original note kept for history: would take the live site down silently
  (~1 week idle). Prioritize the **Supabase Pro** upgrade. No DB backups today.
- **Glen is not Stripe-onboarded** — his audience page correctly shows free-only.
  He must finish Stripe Connect (Setup tab → Set Up Payouts) to take card tips.
- **`statement_descriptor_suffix: "TIP"`** was accepted by Stripe at PaymentIntent
  creation but has not been eyeballed on an actual card statement / dashboard.
  Confirm during F11.
- **No platform fee** on tips today (destination charge, full amount to performer).
  Revisit if/when a platform cut is desired.
- **`stripe-onboard` and `import-spotify` sources are not vendored** into git yet.
- **Legacy emoji remain** in product UI/copy (🎸, 🇪🇸, 🥃, ♪, etc.). Untouched per
  the "don't add, remove only if editing that exact line" rule — a dedicated design
  pass is out of scope.
- **`console.error` calls remain** (kept for diagnosing live failures). If zero
  console output is wanted on the audience page, that's a small follow-up.
- Phase-2 items from the kickoff (gigs table, paywall, DNS cutover, live Stripe
  keys, etc.) remain parked and out of scope.

---

## 7. Plain-English summary for Isaac

Tonight the audience-side tip flow got locked down and polished end to end. Faking a
tip to jump the queue is now impossible; the tip function rejects bad or made-up
amounts and only allows the exact tip options you set; a bug that could take
someone's money without their song ever showing on screen is fixed; performers who
haven't set up Stripe (like Glen right now) now show a clean free-request screen
with your Venmo/PayPal links instead of an error; script-injection through the name
field is neutralized; and after someone pays, they see a smooth "Locking in your
request…" until their song actually appears instead of a confusing gap. All of it is
live and was checked against the real site.

**What to tell Glen:** the app is solid and safe to demo. One thing before he can
take *card* tips on stage — he needs to finish the Stripe payout setup on his Setup
tab (right now his page correctly shows the free request plus your tip-jar links, no
errors). Once he's set up, do one real test-mode tip from his phone and we're done.

**What still needs you (5–10 minutes):** log into the Stripe dashboard so Apple Pay
can be turned on for the site (register the Netlify domain + confirm Apple/Google
Pay are enabled), then a quick tip test on a real iPhone, and confirm the test
payment landed in Stripe. After that I'll bump the version number and we ship.

---

## 8. Commit log (this session)

```
783f44e  chore: strip debug console.log from both files (F10)
f8a12cc  feat: hold a pending state after payment until the request appears (F7)
61bd52a  fix: escape user strings at all innerHTML render sites (F8)
f513330  feat: gate audience tip buttons on performer Stripe readiness (F2)
9f1c1ec  feat: sync stripe_charges_enabled from stripe-status (F2)
3505136  chore: vendor stripe-status source from dashboard (baseline before F2 sync)
89cd3a0  feat: add anon-readable stripe_charges_enabled flag on artist_settings (F2)
2a1a966  fix: make paid/free requests visible on null-session accounts (F6)
312c648  chore: vendor stripe-webhook source from dashboard (for the record)
e9890de  fix: harden stripe-create-tip amount validation and payment methods (F5+F4)
cfac573  chore: vendor stripe-create-tip source from dashboard (baseline before F5/F4)
7710544  fix: constrain anon request inserts to tip_amount=0, status=queued (F1)
d2c2fa4  chore: add gitignore, archive pre-git snapshots, track kickoff doc in docs/
```

---

*LiveQue Session Update v2.4 — July 19, 2026 — prepared by Claude Code.*
*Next session: start here, then finish Section 5.*
