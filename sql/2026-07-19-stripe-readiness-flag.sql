-- F2: gate audience tip buttons on performer Stripe readiness
-- Run: 2026-07-19, Supabase SQL editor, setque-live, role postgres
--
-- The audience page (customer.html, anonymous) rendered paid tip buttons for
-- every performer. If the performer had not completed Stripe Connect
-- onboarding, stripe-create-tip rejects the tip and the audience hits an error
-- mid-payment (Glen's account is exactly this state). Add an anon-readable
-- readiness flag on artist_settings (the anon role already SELECTs this table)
-- so the audience page can render tip buttons only when the performer can
-- actually receive tips.

alter table public.artist_settings
  add column if not exists stripe_charges_enabled boolean not null default false;

-- Backfill from the source of truth (artists) so existing performers are
-- correct immediately, without waiting for their next stripe-status refresh.
-- "Ready" == has a connected account AND fully onboarded — exactly what
-- stripe-create-tip requires before it will create a PaymentIntent, so a true
-- flag guarantees a tip attempt will not fail the readiness check.
update public.artist_settings s
set stripe_charges_enabled = coalesce(a.stripe_account_id is not null and a.stripe_onboarded, false)
from public.artists a
where a.id = s.artist_id;

-- Verify (expect: onboarded performers true, others false)
select a.name, a.stripe_onboarded, s.stripe_charges_enabled
from public.artist_settings s
join public.artists a on a.id = s.artist_id
order by a.name;
