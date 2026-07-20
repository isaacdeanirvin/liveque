# LiveQue — Audience Payment UX Spec (research-backed)
## July 19, 2026 · blueprint for the pay-sheet rebuild (task #14) + Apple Pay (F3)

Evidence base: Stripe docs, Baymard Institute, Nielsen Norman Group (NN/g), W3C WAI/WCAG,
Apple/Google design guidelines, Stanford Web Credibility Project. Vendor (Stripe) conversion
numbers are real A/B tests but self-reported — treat as directional. Independent (Baymard/NN/g/
WCAG) findings are load-bearing.

---

## 1. Core decision: Stripe **Express Checkout Element** (wallets-first), above the Payment Element

- The old **Payment Request Button is deprecated**; Stripe's current component is the **Express
  Checkout Element**, which surfaces **Apple Pay / Google Pay / Link / PayPal** as one-tap buttons
  and auto-dedupes wallets against the card form. (Stripe docs: elements/express-checkout-element)
- Stripe's documented layout: **Express Checkout Element on top**, then a conditional
  "Or pay with card" divider, then the **Payment Element** (card) below. Wallets render only in the
  express element to avoid duplication. (Stripe: payments/elements/build-a-payment-page)
- Conversion signal (Stripe A/B, directional): early Apple Pay via Express Checkout ≈ **2×**
  conversion vs. showing it only at the end; wallets broadly ≈ **+22%**; **Link one-click ≈ +14%**
  for returning users; Link users check out ~3× faster.
- **Link** is a major unlock for repeat bar-goers: recognizes them by email/phone/cookie, OTP, then
  autofills — near-zero typing on their 2nd+ tip. Requires also enabling `card`.

**Build:** replace the current single Payment Element mount in `startTipPayment()` with Express
Checkout Element (wallets) + Payment Element (card), conditional divider gated on
`availablepaymentmethodschange`. Keep our F4 server config (card + wallets, `allow_redirects:never`).

## 2. Layout, top → bottom (one primary action per screen — Hick's Law, NN/g)

1. **Song + exact amount, shown clearly up front.** Unexpected/late costs are the **#1 abandonment
   cause (~39%, Baymard).** If a platform fee is added (see monetization brief), it MUST be disclosed
   here, before the card — never a surprise. (NN/g up-front disclosure; Deceptive Design "hidden costs")
2. **Wallet buttons** (Apple Pay / Google Pay / Link) — big, one-tap.
3. **"Or pay with card"** divider — shown ONLY when a wallet will actually render (event-gated), so
   there's never a dangling divider on unsupported devices.
4. **Card fields**, visually **encapsulated** (distinct border + subtle shading + a small lock/security
   icon inside the block). Baymard: **66% of sites fail to emphasize card-field security**;
   encapsulation is the single most effective perceived-security tactic. **19% abandon from card-
   distrust.**
5. **Pay button** — disabled until valid, then disabled + spinner on submit (prevents double-charge).
6. **Confirmation** — explicit success + amount + what happens next (ties to our F7 pending state).

## 3. Grandma-easy requirements (cited, non-negotiable)

- **Tap targets ≥ 44–48px** (Apple 44pt / Material 48dp / WCAG 2.5.5 AAA 44px; AA floor 24px). Primary
  buttons at 48px.
- **Single column, full-width**; on mobile the keyboard covers ~40–50% of screen (only 2–3 fields
  visible) — every extra field is costly. (Baymard)
- **Real autofill:** correct `autocomplete` tokens (`cc-number`, `cc-exp`, `cc-csc`, `name`) and
  `inputmode="decimal"`/numeric keypad for card fields; never disable autofill. (Baymard) — the Stripe
  Elements handle most of this; verify we don't override it.
- **Plain language, no jargon**; error copy in plain words. (NN/g: concise+scannable+objective = +124%
  measured usability)
- **Familiar patterns** (Jakob's Law): a stranger should recognize the flow instantly — don't invent a
  novel payment UI.
- **Respect text resize to 200%** (WCAG 1.4.4); use relative units.

## 4. Dark-theme accessibility — TOP RISK for our stage-black / Stripe "night" theme

Dark themes commonly FAIL contrast. Audit the pay sheet + palette:
- **Body text ≥ 4.5:1** (WCAG 1.4.3 AA); **aim 7:1** (AAA) for the all-ages/older audience.
- **Large text (≥18pt / 14pt bold) ≥ 3:1.**
- **Every button fill, input outline, and icon ≥ 3:1** against its background (WCAG 1.4.11 Non-text
  Contrast) — the most commonly missed on dark UIs.
- Action: run our gold tip buttons, white-on-black text, and glass-card outlines through a contrast
  checker; fix any that miss. (This is a concrete audit task in the rebuild.)

## 5. Trust / legitimacy (Baymard, NN/g, Stanford)

- **Visual design quality is the #1 first-pass credibility signal** (~46% of users judge credibility on
  look; Stanford). Flawless layout — **a single glitch/typo reads as "phishing" and kills trust**
  (Baymard/NN/g). Our Jony-Ive minimalism is an asset; protect it (no broken states).
- **Encapsulate card fields** + 1 recognized security icon (§2.4).
- **Show the amount + any fee before the card** (§2.1). NN/g Hierarchy of Trust: card entry is a
  high-commitment Level-4 ask — earn it with credibility + clear value first; don't ask for a card (or
  unnecessary personal data) too early.
- Keep data asks minimal (name is already optional — correct).

## 6. Error / decline / 3DS / processing states (NN/g + Stripe)

- **Decline:** never show the raw bank reason (Stripe). Friendly, actionable copy, **preserve input,
  re-enable the button to retry** (our F9 already does inline-error + re-arm — keep, refine copy to be
  non-blaming: avoid "invalid"/"incorrect").
- **3DS:** appears as an in-page modal (no full redirect) or completes frictionlessly. Set expectations:
  "Your bank may ask you to confirm — usually takes a few seconds; check your banking app." Don't force
  the tab closed (timeout can be minutes).
- **Processing:** disable button + spinner + "Processing…" (our F9 has this).
- **Success:** visibility-of-system-status — explicit "$X sent, your request is in the queue" + the F7
  "locking in…" bridge until the row appears.

## 7. Infra prerequisites (need Isaac's Stripe login)

- **Register the web domain(s) for Apple Pay AND Google Pay** in the Stripe dashboard/API — Stripe does
  NOT auto-register for Elements. Register `soft-nasturtium-c51aac.netlify.app` now; re-register
  `getliveque.com` at DNS cutover. One registration covers current + future wallets. (F3)
- **HTTPS/TLS** required for Google Pay — already satisfied on Netlify.
- Apple Pay renders only in **Safari (iOS 10+/macOS Sierra+)**; Google Pay in Chrome/Android + others.

## 8. DO / DON'T

DO: wallets-first, one-tap; show amount + fee up front; encapsulate + secure-icon the card block;
48px targets; plain copy; autofill; audit dark-theme contrast; keep it visually flawless.
DON'T: ask for a card before showing the amount; hide/drip fees; use the deprecated Payment Request
Button; force account creation (we don't); show a dangling "or pay with card" divider; expose raw
decline codes; disable autofill; ship any broken/glitchy state.

---
*Distilled from four cited research studies (Stripe components, conversion evidence, accessibility/
ease-of-use, trust/error-states). Sources inline; full citations in each study.*
