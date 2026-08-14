-- EMERGENCY: card-testing lockdown.
--
-- Four accounts created 10-14 Aug 2026 ran ~263 identical $9 charges whose
-- "song titles" were cardholder names (Chassidy Stack, Nicholas Taylor,
-- Jacqueline Waldron...), all "Anonymous", many per minute. That is card
-- testing, and because LiveQue uses destination charges the disputes land on
-- the PLATFORM balance - Isaac's - at ~$15 a piece plus the amount, while the
-- money has already been paid out to the fraudsters' own bank accounts.
--
-- 1. tips_blocked: a hard per-artist kill switch checked server-side before
--    any PaymentIntent is created. Set on the four known accounts.
-- 2. tip_attempts: an append-only log the tip function writes to, so a single
--    artist or IP cannot fire hundreds of intents a minute ever again.
-- Both tables are service-role only; no client policies exist.

alter table public.artist_settings add column if not exists tips_blocked boolean not null default false;
alter table public.artist_settings add column if not exists blocked_reason text;

update public.artist_settings
   set tips_blocked = true,
       blocked_reason = 'card-testing pattern, locked 2026-08-14',
       stripe_charges_enabled = false
 where artist_id::text like 'dbbf8a5f%'
    or artist_id::text like 'df791696%'
    or artist_id::text like '688528b9%'
    or artist_id::text like 'b839e954%';

create table if not exists public.tip_attempts (
  id          bigserial primary key,
  artist_id   uuid,
  ip          text,
  amount      integer,
  created_at  timestamptz not null default now()
);
alter table public.tip_attempts enable row level security;
create index if not exists tip_attempts_artist_time on public.tip_attempts (artist_id, created_at desc);
create index if not exists tip_attempts_ip_time on public.tip_attempts (ip, created_at desc);

-- Rate check + record in one call. Returns TRUE when the attempt is allowed.
-- Limits: 8 per artist per minute, 40 per artist per hour, 12 per IP per
-- minute. A busy real bar peaks well under this; a card tester blows straight
-- through it.
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
  return n_min < 8 and n_hr < 40 and n_ip < 12;
end $$;
revoke execute on function public.tip_rate_ok(uuid, text, integer) from public, anon, authenticated;
