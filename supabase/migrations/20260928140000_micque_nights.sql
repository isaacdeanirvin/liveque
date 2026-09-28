-- MicQue v3: explicit nights. The host creates the open mic for the right Thursday; sign-ups attach to
-- that night (not "whatever today is"), and sign-ups are only accepted while the night is open.

alter table public.mic_rooms add column if not exists current_night date;

-- Room info is public even while sign-ups are closed (the page still shows the next date and the list).
drop policy if exists mic_rooms_read on public.mic_rooms;
create policy mic_rooms_read on public.mic_rooms for select to anon, authenticated using (true);

-- Realtime on rooms so every phone flips the moment the host opens or closes sign-ups.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='mic_rooms') then
    alter publication supabase_realtime add table public.mic_rooms;
  end if;
end $$;

create or replace function public.mic_assign_position()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; cnt int; maxp int; s jsonb := '{}'::jsonb; k text; r record;
begin
  select max_slots, is_open, current_night into r from public.mic_rooms where id = new.room_id;
  if r is null then raise exception 'NO_ROOM' using errcode = 'P0001'; end if;
  if not r.is_open then raise exception 'NIGHT_CLOSED' using errcode = 'P0001'; end if;
  new.night_date  := coalesce(r.current_night, (now() at time zone 'America/Los_Angeles')::date);
  new.name        := left(trim(new.name), 60);
  new.venmo       := nullif(left(regexp_replace(trim(coalesce(new.venmo,'')), '^@', ''), 40), '');
  foreach k in array array['instagram','tiktok','youtube','spotify','link'] loop
    if coalesce(new.socials, '{}'::jsonb) ? k and length(trim(new.socials->>k)) > 0 then
      s := s || jsonb_build_object(k, left(regexp_replace(trim(new.socials->>k), '^@', ''), 120));
    end if;
  end loop;
  new.socials := s;
  select count(*), coalesce(max(position),0) into cnt, maxp
    from public.mic_signups
   where room_id = new.room_id and night_date = new.night_date and status <> 'bumped';
  if cnt >= coalesce(r.max_slots, 20) then
    raise exception 'LIST_FULL' using errcode = 'P0001';
  end if;
  new.position    := maxp + 1;
  new.status      := 'waiting';
  new.is_featured := false;
  return new;
end $$;
