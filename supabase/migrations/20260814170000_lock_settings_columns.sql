-- Data minimization on artist_settings.
--
-- The public (anon) key could read every column of artist_settings, including
-- Stripe customer/subscription ids, fraud flags, and Pro state. No one has Pro
-- yet so nothing leaks today, but the moment someone subscribes their Stripe
-- ids would be world-readable. Stripe ids are useless without the secret key,
-- but a well-run platform does not hand out its internal ids.
--
-- Fix: the anon role may read ONLY the columns the fan page needs. The
-- performer's own dashboard uses the authenticated role, which keeps full
-- access to its own row via existing RLS. Column privileges are enforced by
-- Postgres and honored by PostgREST, so select('*') from a stranger now errors
-- and the fan page selects the safe set explicitly.

revoke select on public.artist_settings from anon;
grant select (
  artist_id,
  current_gig_session_id,
  payment_methods,
  social_handles,
  tip_amounts,
  drink_mode,
  drink_price,
  stripe_charges_enabled,
  skin
) on public.artist_settings to anon;
