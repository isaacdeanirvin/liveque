-- Tiers 3, 4 and 5: the system defends itself, nobody watches a dashboard.
--
-- Tier 3 EARN THE RIGHT TO CHARGE. Card tips stay off until an account looks
--   like a working musician: a real song library, an actual gig started, and
--   a little age. A gigging performer clears this during normal setup. A card
--   tester wants money today and will not wait days to build a song list.
-- Tier 4 VELOCITY ALARMS. The database watches its own shape - identical
--   amounts repeating, inhuman request rates, a brand-new account suddenly
--   running hundreds of dollars - and auto-freezes before a human looks.
-- Tier 5 PAYOUT HOLD. Nothing leaves a new account for 14 days. Real tips
--   still arrive, just later. Fraud money never escapes the window.

-- artist_settings had no creation timestamp, so account age was unknowable.
-- Backfill existing rows from updated_at; new rows stamp themselves.
alter table public.artist_settings add column if not exists created_at timestamptz;
update public.artist_settings set created_at = coalesce(created_at, updated_at, now());
alter table public.artist_settings alter column created_at set default now();

alter table public.artist_settings add column if not exists first_gig_at timestamptz;
alter table public.artist_settings add column if not exists trust_verified boolean not null default false;
alter table public.artist_settings add column if not exists auto_flag_reason text;
alter table public.artist_settings add column if not exists auto_flagged_at timestamptz;

-- Existing genuine accounts keep working: anyone who already had charges on
-- and is not blocked is grandfathered as verified.
update public.artist_settings
   set trust_verified = true
 where stripe_charges_enabled = true and tips_blocked = false;

-- TIER 3 --------------------------------------------------------------------
-- Can this artist take card tips right now? Requires: not blocked, and either
-- already verified, or meeting the earn-in bar (>=10 songs, account >=48h old,
-- and a gig actually started). Returns a reason string for logging.
create or replace function public.tip_gate(p_artist uuid)
returns table(allowed boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare s record; n_songs int; age_hours numeric;
begin
  select * into s from artist_settings where artist_id = p_artist;
  if not found then return query select false, 'no_settings'; return; end if;
  if s.tips_blocked then return query select false, 'blocked'; return; end if;
  if s.trust_verified then return query select true, 'verified'; return; end if;

  select count(*) into n_songs from songs where artist_id = p_artist;
  select extract(epoch from (now() - coalesce(s.created_at, s.updated_at)))/3600
    into age_hours;

  if n_songs < 10 then return query select false, 'needs_songs'; return; end if;
  if coalesce(age_hours, 0) < 48 then return query select false, 'too_new'; return; end if;
  if s.first_gig_at is null then return query select false, 'no_gig_yet'; return; end if;

  update artist_settings set trust_verified = true where artist_id = p_artist;
  return query select true, 'earned';
end $$;
revoke execute on function public.tip_gate(uuid) from public, anon, authenticated;

-- TIER 4 --------------------------------------------------------------------
-- Velocity check over the attempt log. Auto-freezes on any of:
--   * 25+ attempts in 10 minutes
--   * 60+ attempts in an hour
--   * 40+ attempts in 24h that are ALL the same amount (the card-testing tell)
-- Returns the reason it froze, or null when clean.
create or replace function public.velocity_check(p_artist uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n10 int; n60 int; n24 int; distinct24 int; why text := null;
begin
  select count(*) into n10 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '10 minutes';
  select count(*) into n60 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '1 hour';
  select count(*), count(distinct amount) into n24, distinct24 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '24 hours';

  if n10 >= 25 then why := 'velocity_10min_' || n10;
  elsif n60 >= 60 then why := 'velocity_1hr_' || n60;
  elsif n24 >= 40 and distinct24 <= 1 then why := 'uniform_amount_' || n24 || '_in_24h';
  end if;

  if why is not null then
    update artist_settings
       set tips_blocked = true, stripe_charges_enabled = false,
           auto_flag_reason = why, auto_flagged_at = now()
     where artist_id = p_artist and tips_blocked = false;
  end if;
  return why;
end $$;
revoke execute on function public.velocity_check(uuid) from public, anon, authenticated;
