-- Band safety: two phones can run one band's queue without corrupting it.
--
-- 1. mark_playing(): atomic Now Playing swap. The dashboard's old two-step
--    (UPDATE all to 'queued', then UPDATE target to 'playing') interleaves
--    from two devices and strands two rows in 'playing', one of which
--    vanishes from the rendered queue. One statement cannot interleave.
-- 2. played_songs.source_request_id + unique index: two members tapping
--    Done on the same song double-inserted the row and double-counted the
--    tip in gig stats. The unique pair makes the second insert a no-op
--    (client sends ignoreDuplicates). Legacy rows stay NULL, and NULLs are
--    distinct in a unique index, so history is untouched.
--
-- requests.id's type is introspected rather than assumed so this cannot
-- silently mismatch the live schema.

do $$
declare idtype text;
begin
  select data_type into idtype
    from information_schema.columns
   where table_schema = 'public' and table_name = 'requests' and column_name = 'id';
  if idtype is null then
    raise exception 'public.requests.id not found';
  end if;
  if idtype not in ('uuid', 'bigint', 'integer', 'text') then
    idtype := 'text';
  end if;

  execute format($f$
    create or replace function public.mark_playing(p_artist_id uuid, p_request_id %s)
    returns integer
    language sql
    as $body$
      with changed as (
        update public.requests
           set status = case when id = p_request_id then 'playing' else 'queued' end
         where artist_id = p_artist_id
           and ( (status = 'playing' and id <> p_request_id)
                 or (id = p_request_id and status <> 'playing') )
        returning id
      )
      select count(*)::integer from changed;
    $body$;
  $f$, idtype);

  execute format('alter table public.played_songs add column if not exists source_request_id %s', idtype);
end $$;

create unique index if not exists played_songs_source_request_uniq
  on public.played_songs (artist_id, source_request_id);
