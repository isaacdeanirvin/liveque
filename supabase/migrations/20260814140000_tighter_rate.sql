-- Tighter tip rate limit, per Isaac: cut them off at 3.
--
-- Was 8/min per artist, 40/hr, 12/min per IP. Now 3 attempts per minute per
-- artist. A fan tapping a tip, changing their mind and retrying uses two;
-- three is the ceiling for one person at one act in sixty seconds. A card
-- tester needs hundreds an hour and now dies on the fourth try.
-- Hourly and per-IP ceilings tighten proportionally.

create or replace function public.tip_rate_ok(p_artist uuid, p_ip text, p_amount integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare n_min int; n_hr int; n_ip int;
begin
  select count(*) into n_min from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '1 minute';
  select count(*) into n_hr from tip_attempts
   where artist_id = p_artist and created_at > now() - interval '1 hour';
  select count(*) into n_ip from tip_attempts
   where ip = p_ip and created_at > now() - interval '1 minute';
  insert into tip_attempts(artist_id, ip, amount) values (p_artist, p_ip, p_amount);
  return n_min < 3 and n_hr < 25 and n_ip < 3;
end $$;
revoke execute on function public.tip_rate_ok(uuid, text, integer) from public, anon, authenticated;

-- Velocity auto-freeze tightens to match: a card tester should be frozen in
-- under a minute, not after twenty-five tries.
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

  if n10 >= 12 then why := 'velocity_10min_' || n10;
  elsif n60 >= 30 then why := 'velocity_1hr_' || n60;
  elsif n24 >= 20 and distinct24 <= 1 then why := 'uniform_amount_' || n24 || '_in_24h';
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
