# LiveQue Product Design & Future Development Paper
## Version 2.0 — May 7, 2026
### Author: Isaac Irvin | Prepared with Claude (Anthropic)

---

## Preamble

This document supersedes and extends the LiveQue Kickoff Document v1.0 (February 10, 2026). It incorporates everything built since that writing — Supabase Auth, performer sign-up flow, GitHub deployment, Netlify auto-deploy, iTunes artist search, and Spotify OAuth playlist import — and establishes the design philosophy, feature roadmap, and development principles that will govern every future decision on this platform.

This is a living document. It should be updated at the close of every major development session.

---

## Part I: Where We Stand

### 1.1 What Shipped Since v1.0

The following features moved from roadmap to production between February and May 2026:

**Authentication & Multi-Tenancy**
- Supabase Auth with email/password login screen protecting the admin dashboard
- Dynamic `ARTIST_ID` resolution — no more hardcoded values
- Performer sign-up flow — any musician can create their own account
- Auth-to-artist profile linking via `auth_user_id` column on the `artists` table
- Sign out with full session cleanup

**Infrastructure**
- GitHub repository: `isaacdeanirvin/liveque`
- Netlify auto-deploy connected to GitHub `main` branch
- Live at: `soft-nasturtium-c51aac.netlify.app`
- Every `git push` to `main` deploys to production automatically

**Song Library**
- iTunes Search API integration — search any artist, browse their catalog, select songs with checkboxes, add to library in bulk
- Spotify OAuth (PKCE flow) — performer connects their Spotify account, browses their playlists, selects tracks, imports to library
- Manual song entry preserved as fallback
- Duplicate detection across all import methods

**Current Version:** v6.9.9

---

## Part II: Design Philosophy — The Apple Standard Applied

### 2.1 What Apple's Human Interface Design Team Would Say

Stephen Lemay's team at Apple operates from three axiomatic principles: **Clarity**, **Deference**, and **Depth**. Applied to LiveQue:

**Clarity** means the performer should always know what LiveQue needs from them and why. Right now, a new performer signs up and lands in an empty dashboard with no guidance. That is a clarity failure. The performer has to discover every capability through exploration. Apple would call this "un-opinionated to the point of abandonment."

**Deference** means the interface steps back and makes the performer's music the hero — not the UI. The current dashboard does this reasonably well: dark background, minimal chrome, content-forward. The Tip Options configuration, however, violates deference by putting equal visual weight on administrative controls and live performance tools. Apple would separate these.

**Depth** means that spatial hierarchy communicates importance. Right now, the Dashboard, Live Queue, and QR Code tabs are equal-weight. They should not be. Live Queue is the performing tool. Dashboard is administrative. QR Code is a setup utility used once. The visual weight of each tab should reflect its frequency of use.

### 2.2 The Liquid Glass Moment for LiveQue

Apple's 2026 design language — Liquid Glass — uses translucency and material depth to communicate state. LiveQue's current dark card system is solid and flat. The opportunity: when a gig is actively running (Live Queue tab, queue non-empty, real-time sync active), the entire interface should feel different from the idle state. Alive vs. resting. This is not decoration — it is state communication.

**Recommendation:** A subtle, slow-pulsing teal ambient glow on the Live Queue when a gig is active. Nothing jarring. Think the breathing light on a sleeping Mac. The performer glances at their phone and knows: the system is alive, people are in the room, the queue is watching.

### 2.3 Things Apple Would Never Build the Way We Built Them

**The "Session" badge.** The teal badge reading `Session: gig-17722390...` is engineering data surfaced as a UI element. A performer doesn't need to see the session ID. They need to know: *Is this gig running? How long has it been going?* Replace the session ID badge with a simple elapsed timer: `🎸 Live — 1h 23m`.

**The version number.** `Admin Dashboard v6.9.5` in the header is developer vanity. Remove it from the performer's view. Version numbers belong in Settings > About, not the performing screen.

**Sign out placement.** The Sign Out button sits directly below the LiveQue logo at the top of every screen. A performer should never accidentally sign out during a gig. Move Sign Out to a Settings area. Make it require confirmation. Make it invisible during performance.

---

## Part III: Profile Completion System

### 3.1 The Problem

A new performer signs up for LiveQue. They land in a dashboard that is fully functional but completely empty — no songs, no payment methods, no QR code downloaded, no tip amounts set. There is no guidance. Many performers will not know what to do next. Without songs, the platform is useless. Without payment methods, tips cannot be received. The performer is set up to fail at their first gig.

This is the single highest-impact UX problem in the current application.

### 3.2 The Solution: The Setup Assistant

Apple introduced Guided Access and Setup Assistants as ambient, non-intrusive flows. Never a modal blocking the user. Never a mandatory wizard before you can use anything. Instead: a persistent but dismissible card that tells you exactly what you're missing and makes completing each item a single tap.

**The Setup Assistant Card** appears at the top of the Dashboard tab for any performer whose profile is incomplete. It disappears permanently once all items are checked. It is not a modal. It is not a popup. It is a card in the natural flow of the page.

**Completion Items (in priority order):**

| # | Item | Why It Matters |
|---|------|----------------|
| 1 | Add at least 10 songs | Without songs, audiences have nothing to request |
| 2 | Set up one payment method | Without this, you cannot receive tips |
| 3 | Download your QR code | Without this, no one can find your queue |
| 4 | Set tip amounts | Default (0, 2, 5, 10) is fine but personalization matters |
| 5 | Add at least one social link | Optional but increases fan connection |

**Completion Calculation:**
- Songs ≥ 10: +25 points
- At least one payment method set: +25 points
- QR code downloaded (tracked via localStorage): +20 points
- Tip amounts customized from default: +15 points
- At least one social link: +15 points

**Visual Treatment:**
- Progress ring showing 0-100%
- Each item is a tappable row with a chevron → taking the performer to that exact section
- Completed items show a green checkmark and de-emphasize
- At 100%: card animates out with a brief "🎸 You're ready to perform" message, then disappears forever
- QR download tracking: set `localStorage.setItem('qr_downloaded_' + ARTIST_ID, true)` on PDF download

**Critical Rule:** The Setup Assistant never blocks the performer from using the app. It is advisory only. A performer can ignore it and go straight to Live Queue. The card simply persists until they complete it.

### 3.3 What Triggers the Setup Assistant

The Setup Assistant appears when:
- Performer has fewer than 10 songs in their library, OR
- No payment methods configured, OR  
- QR code has never been downloaded

The Setup Assistant is permanently dismissed when:
- All five items are complete, OR
- Performer explicitly clicks "I'll do this later" (dismisses for 7 days)

### 3.4 Onboarding Email (Future)

When a performer signs up, a welcome email triggers from `noreply@getliveque.com` with:
- Direct link to their dashboard
- 3 things to do before their first gig (songs, payment, QR code)
- Link to a 2-minute setup video

This requires Resend or similar SMTP integration via Supabase Auth hooks.

---

## Part IV: The QR Code Problem

### 4.1 What We Discovered

The QR Code tab currently shows a hardcoded artist name ("Glen Irvin Jr.") for all performers. When a new performer signs up and goes to the QR Code tab, they see Glen's name on their card. This is a critical multi-tenant bug.

### 4.2 The Fix

The QR card artist name field must be pre-populated from the artist's profile in the database. On tab load, fetch the artist's `name` from the `artists` table and populate `qrArtistName` input and `qrArtistDisplay` text with it. The performer can still edit it, but the default should be their own name.

Additionally, the QR code target URL currently points to an old Netlify URL. It must point to the artist's actual customer page URL once slug-based routing is implemented.

---

## Part V: Architecture Decisions That Must Not Be Reversed

These are established patterns from months of development. Any future developer, AI system, or contractor must honor them.

### 5.1 The auth_user_id Pattern

We do not change the `artist_id` in existing tables to match Supabase Auth UIDs. Instead, we add an `auth_user_id` column to the `artists` table that links auth users to their artist record. After login, we query `artists WHERE auth_user_id = user.id` to get the `artist_id`, then use that throughout.

This pattern exists because foreign key constraints across multiple tables make direct ID migration impossible without superuser privileges that Supabase does not grant.

**Never attempt to migrate artist_id values. Always use the auth_user_id bridge.**

### 5.2 The artist_settings Seed Pattern

When a new performer signs up, we must immediately create an `artist_settings` row for them. Currently this does not happen automatically on sign-up, causing a 406 error on first dashboard load. The fix: insert into `artist_settings` in the `signUp()` function immediately after creating the `artists` row.

### 5.3 Variable Declaration Safety

As documented in the v1.0 Kickoff: **never declare the same variable name twice in the same scope.** This breaks the entire application silently. The codebase has no build system, no linter, and no bundler. Every variable must be manually checked for conflicts before adding.

### 5.4 One Feature at a Time

Established principle from v1.0, reinforced through experience: attempting multiple features simultaneously has broken the application repeatedly. Every session must target one feature, test it to working, commit it, then move to the next.

---

## Part VI: Immediate Next Features (Prioritized)

### Priority 1: Fix New Performer Onboarding Gaps

**Who:** Every new performer who signs up.
**What:** Three specific bugs that make the first-run experience broken:
1. QR code shows "Glen Irvin Jr." for all performers
2. No `artist_settings` row created on sign-up (causes 406 error)
3. No guidance on what to do after signing up

**Where:** `signUp()` function in index.html + QR code tab initialization.
**When:** Next session.
**Why:** Until these are fixed, LiveQue cannot be given to any real performer besides Glen. It's the gate to making this a real SaaS product.

**Effort:** 1 session.

---

### Priority 2: Profile Completion / Setup Assistant

**Who:** New performers in their first session.
**What:** The Setup Assistant card described in Part III.
**Where:** Dashboard tab, above Live Stats.
**When:** After Priority 1 is shipped and tested.
**Why:** Performer retention depends on them succeeding at their first gig. They cannot succeed without songs, payment methods, and a QR code. The Setup Assistant is the difference between a performer who gigs with LiveQue and one who signs up, gets confused, and never comes back.

**Effort:** 1-2 sessions.

---

### Priority 3: Remove Debug Logs from Spotify Import

The Spotify import currently has a `console.log('TRACK SAMPLE:', ...)` debug statement that should be removed before any real performers use the feature. Also remove the `console.log('PLAYLIST SAMPLE:', ...)` log from playlist loading.

**Effort:** 5 minutes.

---

### Priority 4: getliveque.com Domain Connection

**Who:** Every performer and audience member.
**What:** Point the registered domain `getliveque.com` to the Netlify deployment.
**Where:** Domain registrar DNS settings + Netlify domain management.
**When:** After Priority 1 and 2 are complete. No point promoting a URL that leads to a broken first-run experience.
**Why:** `soft-nasturtium-c51aac.netlify.app` is not a domain you hand to musicians. `getliveque.com` is.

**Effort:** 30 minutes (mostly DNS propagation wait time).

---

### Priority 5: Row Level Security

**Who:** All performers' data.
**What:** Enable RLS on all Supabase tables and add policies ensuring performers can only read/write their own data.
**Where:** Supabase dashboard, Table Editor, RLS policies.
**When:** Before any marketing or public launch. Currently, anyone with the anon key can read any artist's data.
**Why:** This is the most critical security gap in the system. The anon key is in the client-side HTML. Without RLS, any technical user can read Glen's queue, songs, or settings. Or any other performer's.

**Effort:** 1 session.

---

### Priority 6: Stripe Connect (Real Payments)

As specified in the Kickoff Document v1.0, Section 6. Performers connect their Stripe account. Tips are processed in-app. Venmo/PayPal/CashApp links remain as fallback for performers who opt out of Stripe.

**Effort:** 2-3 sessions.

---

### Priority 7: End Gig + Subscription Gate

As specified in the Kickoff Document v1.0, Section 11. End Gig button saves session data. After 3 completed gigs, performers are prompted to subscribe at $7.99/month.

**Effort:** 2 sessions.

---

## Part VII: The UX Fixes Isaac Can See Today

The following are not new features — they are corrections to existing behavior that affect real performers immediately.

### 7.1 The "No Session" Badge

The badge showing the session ID (or "No Session") is engineering data. Replace it:
- During a gig (queue non-empty): `🎸 Live — [elapsed time]`
- Between gigs (queue empty): `Ready` in a subtle, unobtrusive style
- Remove session ID entirely from the performer's view

### 7.2 The Version Number

Remove `Admin Dashboard v6.9.5` from the performer header. Version numbers belong in a Settings modal, not the live performance screen. Every gig, the performer sees a version number that means nothing to them and clutters precious screen space.

### 7.3 Sign Out Button Position

The Sign Out button is one of the first things a performer sees. It should be the last. Move it to a settings area accessed via a gear icon or profile initial in the corner. Add a confirmation: "Are you sure you want to sign out? This will end your session." A performer who accidentally signs out during a gig loses their queue view.

### 7.4 The Live Queue Tab Should Be Default

Right now, the last visited tab is remembered via `localStorage`. The default on fresh load is Live Queue (correct). But after the Spotify callback redirects back to the app, it often lands on Dashboard. The Spotify callback should always redirect to Live Queue tab after completing the import.

---

## Part VIII: The Long Horizon

### 8.1 HoloStage

HoloStage remains the most ambitious vision in the LiveQue ecosystem. The working prototype (Canvas 2D particle viewer + tip explosion effect) is built. The architecture is defined. The next HoloStage session should target: capturing a live photo via the browser camera, sending it to a cloud GPU, running Apple Depth Pro + SHARP, and returning a basic 3D Gaussian Splat to a WebGL viewer.

Phase 1 target: static photo → 3D splat in under 5 seconds. No live video yet. Prove the pipeline works.

### 8.2 Tidal and Apple Music Import

These remain on the roadmap. The approach is identical to Spotify — OAuth flow, playlist browsing, track selection. The technical challenge with Apple Music is the Apple Developer Program requirement ($99/year) and MusicKit JWT token generation. Tidal's API access requires partnership application. Neither should block the Spotify feature from shipping.

### 8.3 The Marketing Site

`getliveque.com` needs a landing page before any paid marketing. The landing page must:
- Load in under 2 seconds
- Communicate the core value in one sentence above the fold
- Show a demo video (60 seconds, real gig footage)
- Have a single CTA: "Start for free — 3 gigs on us"
- No pricing wall before signup

### 8.4 The Analytics Dashboard

Once gig data is captured (End Gig feature), performers should be able to see:
- Total requests across all gigs
- Total tips earned
- Most requested songs
- Busiest gig days/times
- Average tip per request

This becomes the primary retention mechanism post-subscription. The performer opens LiveQue not just to perform, but to understand their audience. That is a fundamentally different — and stickier — relationship with the product.

---

## Part IX: Development Principles Update

These supersede and extend the principles in Kickoff Document v1.0, Section 15.

1. **Who, What, Where, When, Why before every technical instruction.** No command is given without context. No code is dropped without an explanation of what it does and why.

2. **One feature at a time.** Unchanged from v1.0. Non-negotiable.

3. **Never declare the same variable twice.** Unchanged from v1.0. Non-negotiable.

4. **Always test on the live URL, not the local file.** The local file and the live site are not the same environment. Auth callbacks, Spotify redirects, and Supabase realtime behave differently. The live site is the truth.

5. **Supabase projects pause on the free tier.** Check that the project is active at the start of every session before touching any code.

6. **Commit messages must describe what changed and why.** `v6.9.9 - Spotify OAuth PKCE playlist import` is correct. `fix stuff` is not.

7. **The performer is always on stage.** Every feature decision must be evaluated through the lens of: what happens to a performer who is in the middle of a gig when this breaks? If the answer is "they lose their queue" or "the app goes blank," the feature is not ready to ship.

8. **Never ship without testing the critical path.** Critical path: performer signs in → queue is visible → song requests come in → songs play → gig ends. Every deploy must verify this path works before calling the session complete.

9. **Debug logs must be removed before shipping to performers.** `console.log` statements added for debugging are not production code. Remove them in the same commit or the one immediately following.

10. **Glen is the canary.** Glen Irvin Jr. (`glenirvin@gmail.com`) is the primary test user. Before any feature is considered shipped, it must work for Glen. Not for a test account. Not in incognito. For Glen, on the live site, at his actual artist_id.

---

## Closing Statement

LiveQue missed its Q1 2026 target. That is behind us. The platform that exists today — deployed, authenticated, multi-performer, with Spotify import — is meaningfully more capable than the one described in the February document.

The path to a shipped, monetized, marketable product is clear. It does not require new ideas. It requires executing the ones already on paper, one at a time, with the same discipline that got us from a hardcoded HTML file to a live SaaS platform in three months.

The goal has not changed. The timeline has not changed. What changes is that we now have infrastructure, deployment, auth, and song import working. The next phase is making it beautiful, making it trustworthy, and making it easy for the first hundred performers to join.

Build for Glen. Then build for everyone.

---

*LiveQue Product Design & Future Development Paper v2.0*
*Isaac Irvin | getliveque.com | May 7, 2026*
*Prepared with Claude, Anthropic*
