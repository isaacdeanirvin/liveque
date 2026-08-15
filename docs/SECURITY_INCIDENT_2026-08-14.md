# LiveQue — Security Incident & Hardening Report
### 14 August 2026

This document records the card-testing incident of 14 August 2026, everything
that was changed in response, and why. It is the permanent reference for what
happened and how the platform was hardened.

---

## 1. What happened

Between **10 and 14 August 2026**, four accounts signed up on LiveQue posing as
performers and abused the public tipping endpoint to run **card testing** —
firing stolen card numbers through the tip flow to find which ones still work.

**The evidence was unambiguous:**
- ~263 charges, nearly all for exactly **$9.00**
- Fired many per minute, at all hours
- The "song title" field on each charge held a **person's name** (e.g. "Chassidy
  Stack", "Nicholas Taylor") — the cardholder names the tester was tracking
- Every request submitted as "Anonymous"
- Signup emails were machine-generated throwaways at hotmail.com
- ~$2,838 total volume across the four accounts

The four connected accounts:

| Fake name | Stripe account | Signup email |
|---|---|---|
| AZIZA ELTALKHAWI | acct_1U2rvMELbIFuzApf | NiezGarriepy89@hotmail.com |
| ANTHONY RAFTERY | acct_1U35yBE84sfJw7PL | KrystalRueckerzd@hotmail.com |
| JANNET GARCIA | acct_1U3XwSE5b66Xouns | NataliaGradyqjadp@hotmail.com |
| ADA ORTEGA | acct_1U3XwVEC34f7bON0 | WilmerSchadengb@hotmail.com |

**This was not a hack.** Nobody broke in. They used the normal signup flow and
abused a feature that was open to everyone. That distinction matters: the fix is
gates in front of the feature, not patching a breach.

**The risk to LiveQue:** the platform uses Stripe *destination charges*, so when
these stolen-card charges get disputed, Stripe debits the **platform balance**
(Isaac's), plus ~$15 per dispute. The money had already been routed to the
fraudsters' own connected accounts.

**Why it wasn't a disaster:** the fraud accounts were new, on Stripe's default
daily payout schedule, and **no payout had executed yet**. The money was still
sitting in their Stripe balances when we froze them. We caught it inside the
payout window — by hours.

---

## 2. Immediate response (commits d8fa5fb, fcf0e77)

1. **Killed the four accounts at the payment layer.** A `tips_blocked` flag,
   checked server-side before any PaymentIntent is created. Set on all four.
   *Why: stop any further charges instantly, without waiting on Stripe.*

2. **Froze their payouts.** The Stripe dashboard offers no payout control for
   Express connected accounts (only "Request information"), so this required an
   API call. New `admin-freeze` edge function set all four to manual payouts.
   Verified zero payouts had run. *Why: freeze the money in place so disputes
   claw back from their balances, not Isaac's bank.*

3. **Rate-limited the tip endpoint.** *Why: card testing needs hundreds of
   attempts; the endpoint had no ceiling.*

4. **Self-reported to Stripe.** Email to support@stripe.com with all four
   account IDs and evidence. *Why: Stripe Radar then flags those cards across
   its entire network, and self-reporting protects platform standing.*

---

## 3. The five-tier defense (commits a828c20, a72cd2b, 7b0ba42)

Built so the platform defends itself with no human watching a dashboard.

| Tier | What it does | Why |
|---|---|---|
| **1 — Kill switch** | `tips_blocked` per account, checked before any charge | Instant, unilateral stop for any bad actor |
| **2 — Rate limit** | 3 tip attempts/min per performer and per IP, 25/hr; every attempt logged to `tip_attempts` | A real bar never reaches it; a card tester trips it in seconds |
| **3 — Earn the right to charge** | New accounts cannot take card tips until they have 10+ songs, are 48h+ old, AND have started a real gig (`tip_gate`) | **This is the tier that would have stopped the attack.** No card tester builds a song list and waits two days. Real musicians clear it during setup |
| **4 — Velocity alarm** | Auto-freezes on the fraud *shape* — sustained volume where every amount is identical, or an unverified account moving fast — then emails an alert (`velocity_check`) | Freeze happens before anyone looks. Requires shape not just speed, so a busy Saturday never freezes a real act |
| **5 — Payout hold** | Every new connected account is created with a 14-day payout delay | The luck that saved us (payout hadn't run) is now policy |

Underneath all five: **LiveQue never holds anyone's money.** Every tier is a
gate in front of Stripe, not a vault.

**A false positive was caught and fixed:** rate-limit testing auto-froze a
legitimate act (The Smashing 90's). Tier 4 was rewritten to require the fraud
*shape*, not raw speed — a verified act must exceed 200 attempts/hour before the
system reacts. The band was restored.

---

## 4. Money-integrity fix (earlier same day, commit 59af489)

Glen reported a $2 tip that charged but never appeared in the queue. Root cause:
the tipped-request row was created **only** by the Stripe webhook, so a failed
or slow webhook delivery meant charged-but-not-queued.

**Fix:** new `tip-reconcile` function. A few seconds after a successful payment,
if the row hasn't arrived, the client asks the server to reconcile straight from
Stripe (retrieve the intent, require `succeeded`, read details from the intent's
own metadata, insert idempotently). Money and song can no longer be separated.

*(The $2 was later found safely in the database and in Glen's Stripe balance —
the row had in fact been created; his browser was showing a stale cached page.
See the cache fix in the same day's work.)*

---

## 5. Security audit (commit 665962a)

The live platform was probed with the public (anon) key, the way an attacker
would.

**Passed:**
- No secret or service-role keys exposed client-side (only the anon and
  publishable keys, which are meant to be public)
- Write attacks with the public key **all failed** via Row-Level Security:
  could not unblock a fraud account, grant itself Pro, delete a performer's
  songs, or inject a paid queue-jump for free
- Gift codes unreadable by strangers

**One hardening applied:** `artist_settings` was fully readable by the anon key,
including internal columns (Stripe customer/subscription IDs, fraud flags). Fixed
with column-level grants — the anon role now reads only the nine fan-facing
columns; everything else returns permission-denied. *Why: data minimization. A
well-run platform does not hand strangers its internal IDs, even harmless ones.*

---

## 6. Fort Knox layer (commits 1044cdb, 49c1194)

| Change | What | Why |
|---|---|---|
| **Two-factor login** | Opt-in TOTP (authenticator app) per performer; once on, sign-in requires the 6-digit code | A stolen password stops being enough to reach a musician's earnings |
| **Security headers** | X-Frame-Options DENY, nosniff, strict Referrer-Policy, 2-year HSTS, Permissions-Policy (camera/mic/geo off, payment=self) | Blocks clickjacking, MIME-sniffing, referrer leakage, and HTTP downgrade on public wifi |
| **Audit log** | Append-only `audit_log` of money/trust events (tips, freezes, gift redemptions). RLS denies all client access; an immutability trigger blocks UPDATE/DELETE so history can't be rewritten even with the service key | After an incident you need a receipt, not a memory. This one was reconstructed by hand; the next is one query |
| **Auto-logout** | Dashboard signs out after 45 min of true inactivity; any tap/scroll resets it | A laptop left open at a bar is no longer a standing key. 45 min is generous so a gig never logs the musician out mid-set |

**Bug fixed in the same batch:** the server still rejected any tip not matching a
preset chip, silently breaking the custom-amount field. The $1–$500 integer range
check is now the sole amount guard; custom amounts work.

---

## 7. Where the platform stands

**Bank-grade checklist — 6 of 7 done:**
- ✅ Never custodies money (Stripe is PCI-DSS Level 1; nothing to steal here)
- ✅ Two-factor authentication
- ✅ Tamper-proof audit log
- ✅ Session expiry / auto-logout
- ✅ HTTP security headers
- ✅ Row-Level Security + column-level data minimization
- ⬜ PCI DSS **SAQ-A** self-certification — a form, not code. LiveQue almost
  certainly qualifies (card data never touches the server). Free. Do when the
  paperwork is wanted.
- *(SOC 2 deferred — $15–50k, only relevant when enterprise venues with legal
  departments ask.)*

**Operational notes:**
- Admin tools (`admin-freeze`, `admin-overview`) are gated by an `ADMIN_OPS_TOKEN`
  secret, never called by the app, read-only except the explicit freeze action.
- The four fraud accounts remain blocked and frozen. Stripe support case filed
  with all four account IDs.
- Outstanding human follow-ups: Stripe's reply on dispute liability; Glen
  enabling 2FA on his account; filling out SAQ-A.

---

*Every change in this report is committed to `github.com/isaacdeanirvin/liveque`
(main) and deployed live. Generated 14 Aug 2026.*
