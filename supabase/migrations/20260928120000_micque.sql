-- MicQue: realtime open-mic lineup for a single room (first room: Venice Open Mic @ Hama Sushi).
-- Powered by LiveQue. Reuses the LiveQue project; everything is namespaced mic_* and RLS-locked.
--
-- Security model (mirrors LiveQue's hardened posture):
--   anon  : SELECT rooms + tonight's lineup, INSERT a signup (name only), INSERT a pending tip.
--   host  : NO direct table writes. Every host control (advance, bump, reorder, walk-in, feature)
--           goes through the mic-host edge function, gated by a server-side token (MIC_HOST_TOKEN)
--           and executed with the service role. Anon can never mutate the lineup.

create table if not exists public.mic_rooms (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  venue       text,
  address     text,
  host_name   text,
  host_venmo  text,                     -- arm host tips by setting this (no code change needed)
  schedule    text,
  rules       text[] not null default '{}',
  max_slots   int  not null default 20,
  is_open     boolean not null default true,
  created_at  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_type where typname = 'mic_status') then
    create type public.mic_status as enum ('waiting','on_deck','now','done','bumped');
  end if;
end $$;

create table if not exists public.mic_signups (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.mic_rooms(id) on delete cascade,
  night_date  date not null default ((now() at time zone 'America/Los_Angeles')::date),
  name        text not null check (char_length(trim(name)) between 1 and 60),
  venmo       text check (venmo is null or char_length(venmo) <= 40),
  position    int  not null default 0,
  status      public.mic_status not null default 'waiting',
  is_featured boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- House rule: one turn per artist per night.
create unique index if not exists mic_signups_one_turn
  on public.mic_signups (room_id, night_date, lower(trim(name)));
create index if not exists mic_signups_room_night
  on public.mic_signups (room_id, night_date, position);

-- On insert: server assigns tonight's date + next position, enforces the room cap,
-- and ignores any client-supplied status/featured/position.
create or replace function public.mic_assign_position()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; cnt int; maxp int;
begin
  new.night_date  := ((now() at time zone 'America/Los_Angeles')::date);
  new.name        := trim(new.name);
  new.venmo       := nullif(regexp_replace(coalesce(new.venmo,''), '^@', ''), '');
  select max_slots into cap from public.mic_rooms where id = new.room_id;
  select count(*), coalesce(max(position),0) into cnt, maxp
    from public.mic_signups
   where room_id = new.room_id and night_date = new.night_date and status <> 'bumped';
  if cnt >= coalesce(cap, 20) then
    raise exception 'LIST_FULL' using errcode = 'P0001';
  end if;
  new.position    := maxp + 1;
  new.status      := 'waiting';
  new.is_featured := false;
  return new;
end $$;
drop trigger if exists mic_signups_before_insert on public.mic_signups;
create trigger mic_signups_before_insert
  before insert on public.mic_signups for each row execute function public.mic_assign_position();

create or replace function public.mic_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mic_signups_touch on public.mic_signups;
create trigger mic_signups_touch
  before update on public.mic_signups for each row execute function public.mic_touch();

-- Tips ride LiveQue's direct-pay rail: money goes to the recipient's OWN Venmo, a code in the
-- note confirms it. LiveQue never touches the money. paid can only be flipped by the service role.
create table if not exists public.mic_tips (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.mic_rooms(id) on delete cascade,
  night_date  date not null default ((now() at time zone 'America/Los_Angeles')::date),
  to_type     text not null check (to_type in ('host','performer')),
  to_signup   uuid references public.mic_signups(id) on delete set null,
  amount      int  not null check (amount between 1 and 500),
  pay_code    text not null,
  paid        boolean not null default false,
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists mic_tips_code on public.mic_tips (pay_code);

-- ---------- RLS ----------
alter table public.mic_rooms   enable row level security;
alter table public.mic_signups enable row level security;
alter table public.mic_tips    enable row level security;

drop policy if exists mic_rooms_read on public.mic_rooms;
create policy mic_rooms_read on public.mic_rooms
  for select to anon, authenticated using (is_open);

drop policy if exists mic_signups_read on public.mic_signups;
create policy mic_signups_read on public.mic_signups
  for select to anon, authenticated using (true);

drop policy if exists mic_signups_insert on public.mic_signups;
create policy mic_signups_insert on public.mic_signups
  for insert to anon, authenticated with check (true);   -- trigger sanitizes everything

drop policy if exists mic_tips_read on public.mic_tips;
create policy mic_tips_read on public.mic_tips
  for select to anon, authenticated using (true);

drop policy if exists mic_tips_insert on public.mic_tips;
create policy mic_tips_insert on public.mic_tips
  for insert to anon, authenticated with check (paid = false and paid_at is null);

-- Column lockdown: clients may only INSERT the fields a performer types. Everything else is server-set.
revoke insert on public.mic_signups from anon, authenticated;
grant  insert (room_id, name, venmo) on public.mic_signups to anon, authenticated;
revoke insert on public.mic_tips from anon, authenticated;
grant  insert (room_id, to_type, to_signup, amount, pay_code) on public.mic_tips to anon, authenticated;
-- No UPDATE / DELETE for anon or authenticated on any mic_* table (never granted).

-- ---------- REALTIME ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='mic_signups') then
    alter publication supabase_realtime add table public.mic_signups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='mic_tips') then
    alter publication supabase_realtime add table public.mic_tips;
  end if;
end $$;

-- ---------- SEED: the first room ----------
insert into public.mic_rooms (slug, name, venue, address, host_name, schedule, rules, max_slots)
values (
  'hama-venice', 'Venice Open Mic', 'Hama Sushi', '213 Windward Ave, Venice', 'Mark Stegall',
  'Thursdays, 6 to 8 PM',
  array['No comedy','No backing tracks','Only stringed instruments or percussion','No repeat artists on the same night'],
  20
)
on conflict (slug) do nothing;
