# LiveQue — Status & Go-Live Guide (v3)

_Last updated: 2026-07-20. Frontend: index.html v6.9.20 (performer), customer.html v6.9.15 (audience)._

## What LiveQue is
A live song-request + tipping app for solo/cover musicians. Fans scan a QR code, request songs for free or **tip to bump their pick up the queue**, and pay with Apple Pay / Google Pay / card (Stripe) or the performer's Venmo/PayPal. Performers manage everything from a dashboard. **100% of tips go to the performer — LiveQue takes no cut.**

---

## Live and working right now
- Sign up / login (premium dark auth), custom domain **getliveque.com** (Netlify + SSL).
- Add songs: Spotify link import, artist search, **paste-a-list / CSV**, manual.
- Fan flow: scan QR → request free or tip. Wallets-first (Apple/Google Pay + card); **Link removed** (no login wall).
- **In-app Stripe tips proven end-to-end** (test mode): fan pays → webhook → song appears with tip. Sorts to top of queue.
- Tip celebration: silent **musical confetti** on both the performer's and the fan's screen.
- Backup tips (Venmo/PayPal/Cash App/Zelle) work **with or without Stripe**, including inside the song modal.
- Onboarding wizard + **Performer Guide** at `/help.html`.
- Gig timer fixed (survives refresh).

## Built and vendored, waiting on activation
| Feature | Needs | File(s) |
|---|---|---|
| Audience **ratings** + rate-after-tip | SQL bundle | customer.html, sql/2026-07-19-reviews.sql |
| **Gig recap** email (auto-send on 6h idle / on new gig / button) | SQL bundle + Resend | index.html, supabase/functions/liveque-email, gig-recap-sweeper |
| **Welcome / PR-intro** email on signup | Resend | supabase/functions/liveque-email |
| Server **recap sweeper** (fires even if tab closed) | Resend + cron | supabase/functions/gig-recap-sweeper, sql/2026-07-20-recap-sweep.sql |
| In-app **feedback** | SQL bundle | index.html, sql/2026-07-20-feedback.sql |

All of the above are **graceful**: they stay dormant and never break the live app until switched on.

---

## GO-LIVE CHECKLIST

### A. Database — one paste
Run **`sql/2026-07-20-apply-all-pending.sql`** in Supabase → SQL Editor (project SetQue / setque-live).
Activates: ratings + rate-after-tip, gig-history columns (accurate recap stats), feedback, and the recap dedupe column. Idempotent.

### B. Email (Resend)
1. **Deploy both functions:**
   - `supabase functions deploy liveque-email`
   - `supabase functions deploy gig-recap-sweeper --no-verify-jwt`  ← the sweeper is called by cron with no JWT; it is guarded by its own `x-sweep-secret` instead.
2. **Set secrets** (Supabase → Edge Functions → Secrets):
   - `RESEND_API_KEY` — from resend.com (reuse the Beerlympics account).
   - `SWEEP_SECRET` — any long random string.
   - `EMAIL_FROM` — set to `LiveQue <hello@getliveque.com>` **after** step 3; until then leave unset (Resend's test sender only reaches the account owner's inbox).
3. **Verify getliveque.com in Resend** (add the DNS records it gives you in Namecheap — Claude can drive this). This is what lets email reach *all* performers, not just isaacirvin@gmail.com.

### C. Cron (server-side recap)
After B, run **`sql/2026-07-20-recap-sweep.sql`** — first replace `<SWEEP_SECRET>` in it with the same value from B2. Enables pg_cron + pg_net and schedules the hourly sweep.

### D. Test
- Sign up a throwaway account → **welcome email** should land.
- Do a $1 test tip (card `4242 4242 4242 4242`) → song appears, **confetti**, **rate-after-tip** prompt.
- Tap **Start New Gig** after some activity → **recap email** should land.

---

## Real-money switch (separate from the above)
Stripe is currently in **test/sandbox mode** — no real money moves yet. To take real tips:
1. Activate Stripe live mode (business verification).
2. Swap `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` to **live** values in Supabase secrets.
3. Re-register payment-method domains (getliveque.com) in **live** mode; re-create the webhook in live and set the live `STRIPE_WEBHOOK_SECRET`.
4. Performers re-run **Connect Stripe** in live mode.

---

## Known limitations
- Emails reach only the Resend account owner until the domain is verified (B3).
- Backup tips (Venmo/PayPal) are off-platform, so they can't auto-bump a song.
- Sending marketing blasts to the captured `artists.email` list later will need an **unsubscribe** mechanism (CAN-SPAM) — not built.
- Client-side recap auto-send only fires with the dashboard open; the server sweeper (C) covers closed tabs.
- Some pre-existing UI emoji remain in older screens (not stripped).

## Architecture at a glance
- **Frontend:** static `index.html` (performer) + `customer.html` (audience) on Netlify. No build step.
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions).
- **Edge functions:** `stripe-create-tip`, `stripe-status`, `stripe-webhook` (live), `liveque-email`, `gig-recap-sweeper` (vendored, need deploy).
- **Tables:** `artists`, `artist_settings`, `songs`, `requests`, `played_songs`, `reviews`, `feedback`.
- **Payments:** Stripe Connect destination charges (100% to performer, no application fee).
- **SQL:** every migration mirrored in `sql/` with a dated filename.

## Parked
- Platform fee (task #13) — intentionally off; free for everyone for now.
