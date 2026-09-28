-- MicQue v2: socials at signup, a manager-editable room (host Venmo, announcement, Hama socials),
-- 2 songs per artist. Lineups are kept forever, so past nights become a stay-connected archive.

alter table public.mic_signups add column if not exists socials jsonb not null default '{}'::jsonb;
alter table public.mic_rooms   add column if not exists announcement text;
alter table public.mic_rooms   add column if not exists socials jsonb not null default '{}'::jsonb;
alter table public.mic_rooms   add column if not exists songs_per_artist int not null default 2;

-- Performers may submit socials at signup (anon insert stays limited to exactly these fields).
grant insert (socials) on public.mic_signups to anon, authenticated;

-- Sanitize everything a performer can type. Only known social keys survive, handles are trimmed,
-- '@' stripped, lengths capped. Server still owns date, position, status, featured.
create or replace function public.mic_assign_position()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; cnt int; maxp int; s jsonb := '{}'::jsonb; k text;
begin
  new.night_date  := ((now() at time zone 'America/Los_Angeles')::date);
  new.name        := left(trim(new.name), 60);
  new.venmo       := nullif(left(regexp_replace(trim(coalesce(new.venmo,'')), '^@', ''), 40), '');
  foreach k in array array['instagram','tiktok','youtube','spotify','link'] loop
    if coalesce(new.socials, '{}'::jsonb) ? k and length(trim(new.socials->>k)) > 0 then
      s := s || jsonb_build_object(k, left(regexp_replace(trim(new.socials->>k), '^@', ''), 120));
    end if;
  end loop;
  new.socials := s;
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

update public.mic_rooms
   set rules = array['No comedy','No backing tracks','Only stringed instruments or percussion','2 songs per artist','No repeat sign-ups the same night'],
       songs_per_artist = 2
 where slug = 'hama-venice';
