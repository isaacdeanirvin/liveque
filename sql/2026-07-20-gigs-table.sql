-- Durable gig records — capture each gig's stats permanently
-- Run: 2026-07-20, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- Every time a gig ends (the End Gig button, the 6h auto-send, or silently when
-- the performer starts the next gig) one row is written here with the final
-- numbers. This is the permanent gig history — the queue/played rows get cleared
-- on the next gig, but these numbers are kept forever.
--
-- Idempotent.

create table if not exists public.gigs (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid not null references public.artists(id) on delete cascade,
  gig_session_id   text,
  gig_date         timestamptz,
  duration_minutes integer,
  songs_played     integer not null default 0,
  requests         integer not null default 0,
  tips_total       integer not null default 0,
  tips_count       integer not null default 0,
  top_song         text,
  rating_avg       numeric(3,1),
  rating_count     integer not null default 0,
  ended_via        text,               -- 'button' | 'auto' | 'startnew'
  created_at       timestamptz not null default now()
);

create index if not exists gigs_artist_created_idx on public.gigs (artist_id, created_at desc);

alter table public.gigs enable row level security;

-- Performers manage their own gig history; the cron sweeper writes via the
-- service role (which bypasses RLS).
drop policy if exists "gigs_perform_all" on public.gigs;
create policy "gigs_perform_all"
  on public.gigs
  for all
  to authenticated
  using      (artist_id in (select id from public.artists where auth_user_id = auth.uid()))
  with check (artist_id in (select id from public.artists where auth_user_id = auth.uid()));

select policyname, roles, cmd from pg_policies
where schemaname = 'public' and tablename = 'gigs';
