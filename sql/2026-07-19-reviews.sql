-- Post-gig audience reviews — star rating + optional note for a performer
-- Run: 2026-07-19, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- What this adds: a public.reviews table so an audience member can leave a
-- 1-5 star rating (plus an optional short note and name) for the performer
-- after a set. The performer sees their average and recent notes on their
-- dashboard; the tip page shows the running average as light social proof.
--
-- Security model (mirrors public.requests):
--   - anon (audience) may INSERT a review, but only well-formed ones: stars
--     1-5, note <= 500 chars, name <= 80 chars. id and created_at are defaulted
--     server-side and are not audience-supplied.
--   - Reviews are public reputation, so SELECT is open. The performer reads
--     their own rows through the same open SELECT, scoped by artist_id in the
--     client. The FK to artists(id) means a review can only target a real
--     performer.
--   - No UPDATE or DELETE policy exists, so reviews are immutable through the
--     anon/authenticated API. Moderation, if ever needed, is a service-role or
--     dashboard action.
--
-- Idempotent: safe to re-run. Converges public.reviews to exactly two policies —
-- reviews_anon_insert (anon INSERT) and reviews_public_select (SELECT).

-- 1. Table
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  artist_id      uuid not null references public.artists(id) on delete cascade,
  gig_session_id text,
  stars          smallint not null,
  note           text,
  reviewer_name  text,
  created_at     timestamptz not null default now()
);

-- Value guards at the column level (belt-and-suspenders with the RLS check).
alter table public.reviews drop constraint if exists reviews_stars_range;
alter table public.reviews add  constraint reviews_stars_range
  check (stars between 1 and 5);
alter table public.reviews drop constraint if exists reviews_note_len;
alter table public.reviews add  constraint reviews_note_len
  check (note is null or char_length(note) <= 500);
alter table public.reviews drop constraint if exists reviews_name_len;
alter table public.reviews add  constraint reviews_name_len
  check (reviewer_name is null or char_length(reviewer_name) <= 80);

-- Index for per-artist aggregation and recent-first display.
create index if not exists reviews_artist_created_idx
  on public.reviews (artist_id, created_at desc);

-- 2. RLS
alter table public.reviews enable row level security;

-- Audience may leave a well-formed review.
drop policy if exists "reviews_anon_insert" on public.reviews;
create policy "reviews_anon_insert"
  on public.reviews
  for insert
  to anon
  with check (
    stars between 1 and 5
    and (note is null or char_length(note) <= 500)
    and (reviewer_name is null or char_length(reviewer_name) <= 80)
  );

-- Reviews are public reputation: anyone may read them.
drop policy if exists "reviews_public_select" on public.reviews;
create policy "reviews_public_select"
  on public.reviews
  for select
  using (true);

-- 3. Show resulting policies (appears as the editor result). Expect two rows.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'reviews'
order by cmd, policyname;
