-- ============================================================================
-- LiveQue — apply ALL pending migrations in one paste
-- Run once: Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- Safe to run more than once (every statement is idempotent). This activates:
--   1. reviews        — audience star ratings + rate-after-tip
--   2. played_songs    — gig-history columns for accurate recap stats
--   3. feedback        — in-app performer feedback
--
-- The canonical per-feature files remain in sql/ for history; this is a
-- convenience bundle so you can light everything up at once.
-- ============================================================================

-- ── 1. reviews ──────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  artist_id      uuid not null references public.artists(id) on delete cascade,
  gig_session_id text,
  stars          smallint not null,
  note           text,
  reviewer_name  text,
  created_at     timestamptz not null default now()
);
alter table public.reviews drop constraint if exists reviews_stars_range;
alter table public.reviews add  constraint reviews_stars_range check (stars between 1 and 5);
alter table public.reviews drop constraint if exists reviews_note_len;
alter table public.reviews add  constraint reviews_note_len check (note is null or char_length(note) <= 500);
alter table public.reviews drop constraint if exists reviews_name_len;
alter table public.reviews add  constraint reviews_name_len check (reviewer_name is null or char_length(reviewer_name) <= 80);
create index if not exists reviews_artist_created_idx on public.reviews (artist_id, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "reviews_anon_insert" on public.reviews;
create policy "reviews_anon_insert" on public.reviews for insert to anon
  with check (stars between 1 and 5
    and (note is null or char_length(note) <= 500)
    and (reviewer_name is null or char_length(reviewer_name) <= 80));
drop policy if exists "reviews_public_select" on public.reviews;
create policy "reviews_public_select" on public.reviews for select using (true);

-- ── 2. played_songs gig-history columns ─────────────────────────────────────
alter table public.played_songs add column if not exists tip_amount integer not null default 0;
alter table public.played_songs add column if not exists gig_session_id text;
create index if not exists played_songs_artist_session_idx on public.played_songs (artist_id, gig_session_id);
-- recap dedupe flag shared by the client and the cron sweeper
alter table public.artist_settings add column if not exists recap_sent_session text;

-- ── 3. feedback ─────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid,
  message    text not null,
  created_at timestamptz not null default now()
);
alter table public.feedback drop constraint if exists feedback_message_len;
alter table public.feedback add  constraint feedback_message_len check (char_length(message) between 1 and 2000);
alter table public.feedback enable row level security;
drop policy if exists "feedback_auth_insert" on public.feedback;
create policy "feedback_auth_insert" on public.feedback for insert to authenticated
  with check (char_length(message) between 1 and 2000);

-- ── 4. gigs (durable per-gig stats) ─────────────────────────────────────────
create table if not exists public.gigs (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  gig_session_id text, gig_date timestamptz, duration_minutes integer,
  songs_played integer not null default 0, requests integer not null default 0,
  tips_total integer not null default 0, tips_count integer not null default 0,
  top_song text, rating_avg numeric(3,1), rating_count integer not null default 0,
  ended_via text, created_at timestamptz not null default now()
);
create index if not exists gigs_artist_created_idx on public.gigs (artist_id, created_at desc);
alter table public.gigs enable row level security;
drop policy if exists "gigs_perform_all" on public.gigs;
create policy "gigs_perform_all" on public.gigs for all to authenticated
  using      (artist_id in (select id from public.artists where auth_user_id = auth.uid()))
  with check (artist_id in (select id from public.artists where auth_user_id = auth.uid()));

-- ── verify ──────────────────────────────────────────────────────────────────
select 'reviews' as t, count(*) as policies from pg_policies where schemaname='public' and tablename='reviews'
union all
select 'feedback', count(*) from pg_policies where schemaname='public' and tablename='feedback'
union all
select 'played_songs.tip_amount', count(*) from information_schema.columns
  where table_schema='public' and table_name='played_songs' and column_name='tip_amount';
