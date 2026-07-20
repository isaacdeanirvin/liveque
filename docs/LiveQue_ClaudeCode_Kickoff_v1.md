# LiveQue — Claude Code Kickoff Document
## v1 — July 19, 2026
## Mission: Make the in-app Stripe tip flow flawless on the audience side
### Prepared by Isaac Irvin with Claude (Anthropic). This document is your complete context. Read all of it before touching a file.

---

# 0. Read this first

You are taking over active development of **LiveQue**, a live song-request and tipping platform built and run by a solo founder, Isaac Irvin. The strategy and audit work happens in a Claude.ai project; **you are the execution layer.** You edit the real files in the real repo, commit, and push. Netlify deploys `main` automatically.

**The mission of this session, in one sentence:** an audience member at a bar scans a QR code, picks a song, taps a tip amount, and pays right there on their phone through Stripe — fast, native-feeling, impossible to break, impossible to fake. No Venmo click-out. No app download. No dead ends.

**The prime directive:** LiveQue gets used live, on stage, in front of crowds. A bug during a gig is not a bug — it is a performer standing in front of an audience with a broken product. Every change you make must leave the app in a shippable state. When in doubt, do less, verify more.

---

# 1. What LiveQue is

- **Product:** Live cover musicians put a QR code on bar tables. Audience members scan it (no app, no login), browse the performer's song library, request songs, and optionally tip to push their request up the queue. The performer runs the show from a phone dashboard with a real-time queue.
- **Two surfaces, two files:**
  - `index.html` — the **performer admin dashboard** (auth required). Tabs: Setup / Live / Card.
  - `customer.html` — the **audience page** (anonymous, reached via QR with `?artist=<uuid>`).
- **Business model:** 5 free gigs, then $7.99/month. Not built yet — out of scope for this session, but the reason tip integrity matters: verified tips are the product's core promise.
- **Users right now:** Isaac (founder, performer #2), Glen Irvin Jr. (performer #1, the flagship tester), and as of tonight a second account for Glen's new band. **Glen is the canary: nothing is "shipped" until it works for Glen on the live site.**
- **Design language:** stage-black `#080808`, glass cards, restrained. **No emoji anywhere in product UI or copy.** Clarity over cleverness.

---

# 2. Environment, repo, and deployment

- **Local repo:** `~/Desktop/liveque/`
- **GitHub:** `isaacdeanirvin/liveque` (private). Push to `main` → Netlify auto-deploys in ~60 seconds.
- **Live URLs:**
  - Admin: `https://soft-nasturtium-c51aac.netlify.app`
  - Audience: `https://soft-nasturtium-c51aac.netlify.app/customer.html?artist=<uuid>`
  - `getliveque.com` is registered but DNS is **not** pointed yet. Do not patch URLs to the custom domain in this session.
- **Current versions:** `index.html` = **v6.9.9**, `customer.html` = **v6.9.10**. The files have drifted; this session should bump **both to v6.9.11**. Version strings live in the console.log banner at the top of each file's script and in the help-modal footer of `index.html`.
- **Backend:** Supabase project **"SetQue"**, database branch **"setque-live"**, URL `https://jttswydixqeyyqvcohnq.supabase.co`. Postgres + Auth + Realtime + Edge Functions. The anon key is embedded in both HTML files by design; security is RLS, not secrecy.
- **Supabase Edge Functions currently deployed:**
  - `stripe-create-tip` — called by customer.html; creates the PaymentIntent, returns `client_secret` + `publishable_key`
  - `stripe-webhook` — receives `payment_intent.succeeded`, inserts the tipped request with the **service role** (source is in the repo as `stripe-webhook.ts`; deployed with **Verify JWT OFF** — it authenticates via Stripe signature instead)
  - `stripe-onboard` — creates the Stripe Connect onboarding link for performers (its `RETURN_URL`/`REFRESH_URL` are hardcoded to the Netlify domain — leave as-is until DNS)
  - `stripe-status` — returns `{ has_account, onboarded }` for the logged-in performer
  - `import-spotify` — server-side public-playlist scrape for song import (not part of this mission; do not touch)
- **Stripe is in TEST mode.** Live-key switch is a separate launch task. Do **not** touch keys this session. All verification uses test cards.
- **Testing rule:** always verify on the **live Netlify URL**, from a real phone when possible — Supabase Realtime and Stripe behave differently than local files. Local-file testing does not count as verification.

---

# 3. Architecture you must not fight

- **Vanilla HTML/CSS/JS, one file per surface.** This is deliberate. Do not introduce a framework, a build step, or split files. Make surgical edits.
- **Auth bridge pattern:** Supabase Auth users link to the `artists` table via `artists.auth_user_id = auth.uid()`. Never migrate or rewrite `artist_id` values; always join through the bridge.
- **Tables (5):** `artists`, `artist_settings`, `songs`, `requests`, `played_songs`. There is **no `gigs` table** — gig sessions exist only as a string (`artist_settings.current_gig_session_id`, format `gig-<ts>-<rand>`). A gigs table is planned (Phase 2) but **out of scope tonight.**
- **RLS state:** fully locked down as of v6.9.7. Logged-in performers can only touch rows where `auth_user_id = auth.uid()` (through the bridge). Anonymous audience role has scoped SELECT plus **INSERT on `requests` only**. Performer emails are protected by column grant.
- **Realtime:** both surfaces subscribe to `postgres_changes` on `requests` and `played_songs`, filtered by `artist_id`. A separate broadcast channel handles the "queue cleared" event on Start New Gig.
- **`ON DELETE CASCADE`** is in place: deleting an auth user wipes the artist and settings rows cleanly.

---

# 4. The Stripe tip flow exactly as it exists today

Trace it before you change it. Line numbers are approximate but close.

**customer.html (audience):**
1. Audience taps a song → `openRequestModal(title, artist, spanish)` (~line 907). Renders a name input, a "Request (Free)" button, and one gold button per tip amount from the performer's `tip_amounts` (default `[0, 2, 5, 10]`). **The tip buttons render unconditionally — whether or not the performer has Stripe set up.**
2. Free path: `requestSong(0)` (~line 943) inserts directly into `requests` with the anon key, `tip_amount: 0`, `status: 'queued'`, `gig_session_id: currentGigSessionId`.
3. Paid path: `startTipPayment(amount)` (~line 979) invokes `stripe-create-tip` with `{ artist_id, amount, song_title, song_artist, requester_name }`. On success it mounts a **Stripe Payment Element** (`theme: 'night'`) inside the modal and arms the Pay button.
4. `confirmTipPayment()` (~line 1028) calls `stripe.confirmPayment({ elements, redirect: 'if_required' })`. **No `return_url` is passed.** On `succeeded`: success toast, modal closes. On error: inline message, button re-arms.
5. **The tipped request row is NOT inserted by the client.** It arrives via the webhook.

**stripe-webhook.ts (server, service role):**
- Verifies the Stripe signature, handles `payment_intent.succeeded`.
- Looks up the performer's `current_gig_session_id` from `artist_settings` at insert time.
- Inserts into `requests` with the real `tip_amount` and `stripe_payment_intent_id`.
- Idempotent: a unique constraint on `stripe_payment_intent_id` makes Stripe retries a safe no-op (error code `23505` is swallowed). This is correct — preserve it.

**index.html (performer):**
- Setup tab has Stripe Connect onboarding: `startStripeOnboarding()` (~line 870) → `stripe-onboard` → redirect to Stripe; `handleStripeReturn()` reads `?stripe=done|refresh` on return; `refreshStripeStatus()` (~line 900) → `stripe-status` → renders "Payouts active" / "Setup incomplete" / "Set Up Payouts".
- The realtime INSERT event from the webhook's insert is what makes the tipped request appear in the performer's queue, sorted by `tip_amount` descending.

**The queue-priority rule:** `sortRequestQueue()` on both surfaces sorts playing first, then tip descending, then created ascending. Tips are the entire priority mechanism.

---

# 5. Definition of "flawless" — the gap list

Each item: what's wrong, why it matters, the fix. These are ordered; F1–F6 are the session's core.

### F1. Tip integrity — close the fake-tip hole (CRITICAL, do first)
- **What:** The anon INSERT policy on `requests` does not constrain column values. Anyone with the page-source anon key can insert `tip_amount: 999` and jump the whole queue without paying.
- **Why:** Verified tips are the product. This hole defrauds paying audience members and falsifies the performer's earnings.
- **Fix:** Alter the anon INSERT policy to `WITH CHECK (tip_amount = 0 AND status = 'queued')`. The webhook uses the service role and bypasses RLS, so real tips are unaffected. After this lands, **Stripe is the only path to priority** — which is exactly the promise.
- **Verify:** attempt a crafted anon insert with `tip_amount: 50` via the REST endpoint → must be rejected. Free request via the UI → still works. Test-mode Stripe tip → still lands with correct amount.

### F2. Gate tip buttons on performer Stripe readiness
- **What:** `openRequestModal` shows paid tip buttons for every performer. If the performer never completed Connect onboarding, `stripe-create-tip` fails and the audience hits an error mid-flow. Glen's brand-new band account tonight is exactly this state.
- **Why:** An audience member holding their card and getting an error is the worst possible first impression of the product.
- **Fix (recommended shape):** add a boolean the anon role can read — e.g. `artist_settings.stripe_charges_enabled` — set to true by `stripe-status` (and/or a Stripe `account.updated` webhook) when `charges_enabled` is confirmed. customer.html reads it in `loadFromSupabase()`; if false, render the free-request button only, with the existing external tip-jar links as the fallback tip path. No error states, just graceful absence.
- **Verify:** unconnected account shows free-only modal; connected account shows tip buttons.

### F3. Apple Pay and Google Pay in the Payment Element
- **What:** "Pay from their phone, super easy" means wallets. The Payment Element shows Apple Pay / Google Pay automatically only when: they're enabled in the Stripe dashboard's payment-method settings, the domain is registered for Apple Pay, and the page is HTTPS.
- **Fix:** enable wallets in the Stripe test dashboard; register `soft-nasturtium-c51aac.netlify.app` for Apple Pay (Stripe dashboard → Payment method domains). Note in the handoff doc that `getliveque.com` must be registered when DNS lands.
- **Verify:** on a real iPhone (Safari) the Apple Pay button appears above the card form; a test-mode wallet payment completes.

### F4. Kill the silent redirect trap
- **What:** `confirmPayment` uses `redirect: 'if_required'` with **no `return_url`**. Any redirect-based payment method (Cash App Pay, Klarna, etc., if ever enabled in the dashboard) will throw at confirm time.
- **Fix:** in `stripe-create-tip`, restrict the PaymentIntent to card + wallets (`payment_method_types: ['card']` covers Apple/Google Pay via the card rails, or use `automatic_payment_methods` with `allow_redirects: 'never'`). This makes the no-return_url client code correct by construction.
- **Verify:** intent creation shows only card/wallet options in the Element.

### F5. Server-side amount validation in `stripe-create-tip`
- **What:** The client sends `amount`. Review the function source: it must reject non-integers, zero/negative values, and absurd values, and ideally require the amount to be one of the performer's configured `tip_amounts` (fetch them server-side by `artist_id`). Also confirm: currency pinned to USD, metadata carries `artist_id`, `song_title`, `song_artist`, `requester_name`, `tip`, and a sane statement descriptor (e.g. `LIVEQUE TIP`).
- **Why:** never trust the client with money math — your own principle: front-end code cannot be hidden.
- **Verify:** a forged invoke with `amount: 0.5` or `amount: 99999` is rejected with a clean error.

### F6. The paid-but-invisible bug (null gig session)
- **What:** For a brand-new performer, `current_gig_session_id` is `null`. The webhook inserts the paid request with `gig_session_id: null`. customer.html loads the queue with `.eq('gig_session_id', currentGigSessionId)` — and PostgREST's `eq` does **not** match SQL NULLs. Result: an audience member **pays real money and their request never appears on the audience screen.** (The performer's dashboard does show it — the admin load has no session filter.)
- **Fix, two layers:**
  1. **Signup:** auto-mint a gig session id in the `artist_settings` insert inside `signUp()` (index.html) so no account ever has a null session.
  2. **Defense:** in customer.html's queue load and in the webhook, handle the null case (webhook: if session is null, mint one and write it back, or insert with a sentinel the query handles; client: use `.is()` fallback when session is null).
- **Verify:** fresh test account → tip a request **before** ever tapping Start New Gig → request appears on both surfaces.

### F7. Post-payment experience — the 1-to-5-second gap
- **What:** On `succeeded`, the client shows "your request is in the queue" instantly, but the row actually arrives via webhook → insert → realtime, typically 1–5 seconds later. On slow venue wifi the audience member stares at a queue that doesn't contain their song yet.
- **Fix:** after confirm succeeds, show a lightweight pending state ("Locking in your request…") until the realtime INSERT with a matching song title/requester arrives, then celebrate normally. Timebox it (e.g. 10s) and fall back to a reassuring message — the webhook's Stripe-retry + idempotency already guarantees eventual delivery, so never imply failure.
- **Verify:** on-screen, the request visibly appears in the audience queue after payment with no manual refresh.

### F8. Stored XSS hardening (rides along with this mission)
- **What:** `requester_name` (audience-controlled) — and via crafted inserts, `song_title`/`song_artist` — are concatenated raw into `innerHTML` in `renderLiveQueue()` (index.html ~692) and `renderNowPlaying()` / `renderAudienceQueue()` (customer.html ~720–770), plus the modal header (~910). No escaping helper exists in either file.
- **Why it belongs in the Stripe session:** the paid flow carries `requester_name` onto the performer's authenticated dashboard and every audience phone. A payment flow that transports script injection is not flawless.
- **Fix:** add a small `escapeHTML()` helper to both files and apply it at every render site where user-originated strings enter `innerHTML` (~8 sites). Do not refactor the render architecture — escape and move on.
- **Verify:** request a song with name `<img src=x onerror="alert(1)">` → renders as literal text everywhere.

### F9. Error-state polish (mostly exists — verify, don't rebuild)
- Card decline → inline message + re-armed Pay button (exists). Double-submit → button disabled while processing (exists). `processing` status → yellow "Payment processing…" (exists). Confirm each behaves on the live site with Stripe's test cards; fix only what's actually broken.

### F10. Remove debug logging from the audience page
- customer.html logs payment methods, social handles, and session ids to the console on every load. Strip the debug `console.log`s from both files (keep the single version banner). Standing rule: no debug logs where a real performer or audience member can see them.

### F11. Verify the money actually lands
- In test mode, run one tip end-to-end and confirm in the Stripe dashboard: the PaymentIntent succeeded, funds route to the performer's connected account (check how `stripe-create-tip` structures it — destination charge vs direct), any application fee is what Isaac expects (document what you find — if there's no platform fee yet, note it in the handoff), and the webhook delivery log shows 200s.

---

# 6. Ordered work plan

Work strictly in this order. **One item at a time, verify, commit, then the next.** Small commits with clear messages.

1. **F1** — RLS policy tighten (SQL in Supabase; save the statement in the repo as `sql/2026-07-19-tip-integrity.sql` for the record)
2. **F5 + F4** — review and harden `stripe-create-tip` (amount validation, method restriction, metadata, descriptor)
3. **F6** — null-session fix: signup-time session mint + defensive handling in customer load and webhook
4. **F2** — `stripe_charges_enabled` flag + customer.html gating with graceful free-only fallback
5. **F8** — `escapeHTML` across both files
6. **F7** — post-payment pending state on customer.html
7. **F3** — enable wallets + Apple Pay domain registration (dashboard work; verify on iPhone)
8. **F9 + F10** — error-state verification pass, strip debug logs
9. **Version bump both files to v6.9.11**, final end-to-end test, **F11** money-landing verification
10. Write the handoff doc (see Section 9)

If any single item balloons, stop, ship what's verified, and flag the rest — do not leave the repo mid-surgery.

---

# 7. Test protocol

**Stripe test cards (test mode):**
- `4242 4242 4242 4242` — success
- `4000 0000 0000 9995` — decline (insufficient funds)
- `4000 0027 6000 3184` — requires 3D Secure challenge

**End-to-end scenarios, all on the live Netlify URL, phone where noted:**
1. Free request → appears on audience queue and admin queue in real time
2. $5 tip, test card success → payment succeeds → request appears on BOTH surfaces with the $5 priority badge, sorted above free requests
3. Decline card → clean inline error, retry with good card succeeds
4. 3DS card → challenge completes in-modal, request lands
5. Crafted anon REST insert with `tip_amount: 50` → rejected (F1 proof)
6. Forged `stripe-create-tip` invoke with a bogus amount → rejected (F5 proof)
7. Fresh account, tip before first Start New Gig → visible on both surfaces (F6 proof)
8. XSS name string → rendered inert everywhere (F8 proof)
9. Unconnected-Stripe account → modal shows free-only, no errors (F2 proof)
10. iPhone Safari → Apple Pay button present, wallet payment completes (F3 proof)
11. Stripe dashboard: webhook deliveries all 200, funds on the connected account (F11 proof)

**Then the canary:** Glen (or his new band account) runs a real test-mode tip from his own phone. Only after that is the mission complete.

---

# 8. Rules of engagement (non-negotiable, from Isaac)

1. **Who / What / Where / When / Why before every technical instruction you give Isaac.** Any time you hand him a command to run, a dashboard toggle to flip, or a step to perform, precede it with a brief 5-W framing. This is a standing project law.
2. **One feature at a time.** Parallel feature work has broken this app before. The ordered plan in Section 6 is the queue; do not interleave.
3. **Surgical edits only.** Never regenerate a whole file — these are 1,000+ line single-file apps and full regens have silently dropped functions in the past. Edit in place.
4. **Glen is the canary.** Nothing is shipped until verified on the live site, ideally on Glen's phone.
5. **Test on the live URL**, never local files — Realtime and Stripe don't behave locally.
6. **No emoji** in product UI, product copy, or commit messages. (Legacy emoji exist in the code — do not add more; you may remove them if you're already editing that exact line, otherwise leave them for a dedicated design pass.)
7. **Remove debug logs** before a real performer or audience member can see the feature.
8. **Commit style:** imperative, scoped, honest — e.g. `fix: constrain anon request inserts to tip_amount=0 (tip integrity)`. Push to `main` only when the working state is verified.
9. **Database changes** happen in the Supabase SQL editor against `setque-live`; mirror every statement into the repo under `sql/` with a dated filename so schema history lives in git.
10. **Do not touch:** live Stripe keys, DNS/domain URLs, the `import-spotify` function, RLS policies beyond F1's insert policy, and anything in the Phase 2 gigs-table plan.
11. **Isaac's communication style:** terse confirmations during execution ("ok", "lets do it") mean go. He is thorough in planning, fast in execution. Match that: short status lines while working, substance when a decision is needed.

---

# 9. Definition of done + session-end deliverables

The mission is complete when all eleven test-protocol scenarios pass on the live site and the canary test is green. At session end, produce:

1. **`LiveQue_Update_v2_4.md`** (or the next number in the repo's update-doc sequence) — the handoff document in the established style: what was done, exact diffs summarized, SQL run, decisions made, known issues remaining, what ships next. This document is the starting context for the next session; write it like the reader knows nothing.
2. A one-paragraph **plain-English summary for Isaac** of what changed and what he should tell Glen.
3. An updated **known-issues list** — anything discovered but deliberately deferred, so nothing silently disappears.

---

# 10. Out of scope — do not build tonight

Parked, on the record, in priority order for future sessions: the `gigs` table + archive-not-delete + Start New Gig as an Edge Function (Phase 2 — the paywall's foundation), End Gig + post-gig summary screen, gig counter + 5-free-gigs paywall, comp/access codes, $7.99 subscription billing, DNS cutover + URL patches + Apple Pay re-registration on getliveque.com, Stripe live keys, Supabase Pro upgrade, recruiting footer on customer.html, duplicate-request stacking, setup assistant, multi-band accounts, and everything HoloStage.

---

*LiveQue Claude Code Kickoff v1 — July 19, 2026*
*Isaac Irvin | getliveque.com*
