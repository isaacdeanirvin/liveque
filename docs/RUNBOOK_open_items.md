# Open items that need Isaac or Glen

Everything in the codebase is done and pushed. These need a login I do not have.
Ordered by what costs money or risk soonest.

Last updated 20 July 2026, at v6.9.34.

---

## 1. Deploy the two edge functions (10 minutes, highest value)

Both fixes are committed but **inert until deployed**. Right now the money bug is
still live in production.

```bash
brew install supabase/tap/supabase     # if not installed
supabase login
cd ~/liveque
supabase link --project-ref jttswydixqeyyqvcohnq
supabase functions deploy stripe-create-tip
supabase functions deploy stripe-webhook
```

Careful: the project ref is `jttswydixqeyyqvcohnq` (SetQue / setque-live).
`czqtpsgjqboxqjlfjmgg` is Beerlympics. Do not link the wrong one.

**`stripe-create-tip` is the one that stops the bleeding.** Until it deploys,
every tip costs you the Stripe fee out of pocket.

### Verify it worked

Send yourself a $5 test tip, then in the Stripe Dashboard open the payment and check:

| Field | Expected |
|---|---|
| Amount | $5.00 |
| Application fee | **$0.45** |
| Transfer to connected account | **$4.55** |
| Your platform net | **$0.00** |

If the application fee is missing, the deploy did not take.

---

## 2. Subscribe to the dispute event in Stripe (2 minutes)

The clawback code cannot fire until Stripe sends the event.

Stripe Dashboard → Developers → Webhooks → your existing endpoint → **Add events** →
select **`charge.dispute.created`**.

The endpoint should already be receiving `payment_intent.succeeded`. Adding the
dispute event is additive and will not disturb it.

Without this, a disputed tip still costs you the full amount plus the dispute fee.

---

## 3. Turn on negative balance debits (1 minute)

When a performer has already been paid out, the transfer reversal fails and LiveQue
absorbs the loss. This is what lets Stripe chase it instead.

Stripe Dashboard → Connect → Settings → enable debiting connected accounts for
negative balances. Confirm `debit_negative_balances` is `true` on new accounts.

While you are in there, check **who owes 1099-K filings**. With destination charges
Stripe files only when `controller.fees.payer` is set to the connected account.
If it is set to the platform, **LiveQue owes the filings** for any performer over
$20,000 and 200 transactions. Worth knowing before January.

---

## 4. Make support@getliveque.com actually receive mail (5 minutes)

`terms.html` and `privacy.html` both publish this address. **If it bounces, the
policy is lying**, and under Cal. Bus. & Prof. Code §22576 failing to follow your own
posted privacy policy is itself the violation. A dead contact address is worse than
no policy at all.

Simplest fix: a forwarding rule to isaacirvin@gmail.com at your DNS or email host.
If you would rather use a different address, tell me and I will change both pages.

---

## 5. Turn on Cash App Pay (10 minutes, optional but cheap)

The only confirmable payment method that resembles the P2P apps people already have.
Same 2.9% + 30¢ as cards, works on destination charges, fires the webhooks we already
handle. No code change needed.

Stripe Dashboard → Settings → Payment methods → enable **Cash App Pay**. Connected
accounts need the `cashapp_payments` capability.

Note it is US-only, USD-only, and not supported in the Express Checkout Element.

---

## 6. The cron job is still not running (5 minutes)

`sql/2026-07-20-recap-sweep.sql` line 30 still contains the literal `<SWEEP_SECRET>`.
Until it runs, the 6-hour auto-recap never fires and only a manual End Gig sends one.

I will not paste a secret into a file or a SQL editor, so this one is yours: replace
the placeholder with the real value and run it in the Supabase SQL editor.

**Rotate `SWEEP_SECRET` first.** It was pasted into our chat, so treat it as burned.
Also note the cron SQL stores it as plaintext in the `cron.job` table, so anyone with
database access can read it.

---

## 7. Register the copyright on the source (20 minutes, $45 to $65)

Do this now rather than after someone copies you. Under 17 U.S.C. §411(a) you cannot
file suit without a registration, and *Fourth Estate v. Wall-Street.com* (2019) held
that means an actual registration, not a pending application. Waiting means waiting
months at the exact moment you need it.

<https://www.copyright.gov/registration/>

This is the thing that actually protects you. The anti-copying clause in the Terms
does very little against a competitor who never agreed to them.

---

## 8. Lawyer: exactly three things

Do not pay for a full review. Pay for these:

1. **The patent opinion.** US 11,790,339 B2 and its family (11,455,607 / 11,823,150 /
   12,387,187, plus published application 2024/0062176) cover paid audience requests
   to live performers. Claim 12 covers a performer-defined song catalog; claim 15
   covers a request carrying a financial incentive. Active until roughly 2041 and
   still spawning continuations. Ask specifically whether being a browser app with
   nothing installed puts us outside claim 1, which requires software "preloaded onto
   the memory of the mobile device."
2. **The arbitration clause** in `terms.html` §10, including the EFAA carve-out.
   Generators produce language courts strike.
3. **The chargeback allocation** in `terms.html` §3. That clause is what lets you
   recover a disputed tip, and it is specific to our destination-charge setup.

Everything else in those documents is standard scaffolding.

---

## 9. Trademark (when there is budget)

`LIVEQUE`, serial 90102108, filed by Uniqcue Inc. in 2020, went **abandoned on
4 October 2021** after no Statement of Use was filed. It had already been approved
for publication, meaning USPTO found it registrable. The lane looks open.

Get a real clearance search before spending on branding. Uniqcue may retain
common-law rights and their Class 9/42 description covered similar functionality.
Filing is $350 per class.

---

## 10. Smaller, whenever

- **DMCA agent registration**, $6, at <https://dmca.copyright.gov/>. Thin exposure
  since song titles are not copyrightable and the only user content is the rating
  note, but it is $6 and must be renewed every 3 years.
- **Raise the tip anchors.** Peer-reviewed field experiment across 1,587 street
  performances found the default anchor is the dominant lever on tip size, with
  £10 at +0.85 and £20 at +1.16 against a £3 reference, and no backlash. Our $5
  default sits at the bottom of the tested range. See `LiveQue_CopyResearch.md`.
- **Business address** on the site. Stripe's website checklist asks for it.
- **`landing.html`** is now a stale duplicate of the front page. Left live on purpose
  in case Glen has the link. Say the word and I will redirect it to `/`.
- **Real QR vector art** before the business cards print. The current one is a
  placeholder pattern and needs a test scan off a printed proof, not a screen.

---

## What is already done

- Terms of Service and Privacy Policy live, with Stripe's prescribed language verbatim
- Clickwrap at performer signup, unticked by default, blocking
- Assent text beneath the fan Pay button
- Dispute clawback handler written, clamped to the transfer balance
- Application fee set so LiveQue nets exactly zero instead of losing the Stripe fee
- Venmo and Zelle removed, PayPal kept with honest "will not move your song" labelling
- 21 form fields given accessible names
- All 73 em dashes removed from user-facing copy
- Landing page rewritten against the research in `LiveQue_CopyResearch.md`
