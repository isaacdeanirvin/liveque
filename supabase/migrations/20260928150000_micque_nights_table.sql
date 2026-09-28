-- Every open mic night is its own saved record (date, note, start/end), so people can go back
-- and view any night, and the archive can be searched by date and note as well as by name.
create table if not exists public.mic_nights (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.mic_rooms(id) on delete cascade,
  night_date  date not null,
  note        text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  unique (room_id, night_date)
);
alter table public.mic_nights enable row level security;
drop policy if exists mic_nights_read on public.mic_nights;
create policy mic_nights_read on public.mic_nights for select to anon, authenticated using (true);
-- writes: service role only (the mic-host function), never anon.

-- Backfill: any night that already has sign-ups gets a record.
insert into public.mic_nights (room_id, night_date, started_at)
select room_id, night_date, min(created_at) from public.mic_signups group by room_id, night_date
on conflict (room_id, night_date) do nothing;
