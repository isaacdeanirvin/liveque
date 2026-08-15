-- Unfreeze Glen, and stop the velocity alarm punishing a busy real act.
--
-- Testing the new rate limit against The Smashing 90's tripped the auto-freeze
-- and blocked a legitimate performer. That is the false positive that matters:
-- a packed bar on a Saturday can absolutely produce 12 tip attempts in ten
-- minutes, and freezing the band mid-set would be worse than the fraud.
--
-- The fix is to require SHAPE, not just volume. Raw speed alone no longer
-- freezes anyone. An account is frozen only when it is fast AND looks wrong:
--   * every tip the identical amount (the card-testing signature), or
--   * the account has not yet earned trust (new, unproven).
-- A verified act with varied tips can be as busy as it likes.

update public.artist_settings
   set tips_blocked = false,
       stripe_charges_enabled = true,
       trust_verified = true,
       auto_flag_reason = null,
       auto_flagged_at = null
 where artist_id::text like '00f23ec7%';

create or replace function public.velocity_check(p_artist uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  n10 int; n60 int; n24 int; distinct24 int;
  verified boolean; why text := null;
begin
  select coalesce(trust_verified, false) into verified
    from artist_settings where artist_id = p_artist;

  select count(*) into n10 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '10 minutes';
  select count(*) into n60 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '1 hour';
  select count(*), count(distinct amount) into n24, distinct24 from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '24 hours';

  -- The signature: sustained volume where every single amount is identical.
  -- Real rooms mix $2, $5, $10, drinks and custom amounts; a card tester
  -- hammers one number.
  if n24 >= 20 and distinct24 <= 1 then
    why := 'uniform_amount_' || n24 || '_in_24h';

  -- Unproven accounts get a much shorter leash: they have no gig history to
  -- justify volume, so speed alone is enough to stop them.
  elsif not verified and n10 >= 12 then
    why := 'unverified_velocity_10min_' || n10;
  elsif not verified and n60 >= 30 then
    why := 'unverified_velocity_1hr_' || n60;

  -- A verified act would have to be truly extreme - well past any real room -
  -- before we touch it.
  elsif verified and n60 >= 200 then
    why := 'extreme_velocity_1hr_' || n60;
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
