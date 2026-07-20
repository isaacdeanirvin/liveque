-- Gig history retention on played_songs (for accurate recap stats)
-- Run: 2026-07-20, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- Why: markAsComplete moves a request into played_songs and deletes the request
-- row. played_songs did not keep the tip amount or which gig it belonged to, so
-- a post-gig recap could not total the night's tips or scope songs to one gig.
-- These two columns let the recap email report accurate per-gig numbers. Rows
-- that predate this backfill to tip_amount 0 / null session, which is fine.
--
-- Additive and idempotent; no RLS change (played_songs policies are scoped by
-- artist_id, not by column).

alter table public.played_songs add column if not exists tip_amount integer not null default 0;
alter table public.played_songs add column if not exists gig_session_id text;

create index if not exists played_songs_artist_session_idx
  on public.played_songs (artist_id, gig_session_id);

-- Show the resulting columns (appears as the editor result).
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'played_songs'
order by ordinal_position;
