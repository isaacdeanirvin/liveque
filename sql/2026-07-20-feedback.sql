-- In-app performer feedback ("tell us what you like / what you don't")
-- Run: 2026-07-20, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- A place for performers to send Isaac & Glen feedback from inside the app.
-- Authenticated performers may insert a bounded message; reviewing happens in
-- the Supabase dashboard (service role), so no SELECT policy is exposed.
-- Idempotent.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid,
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.feedback drop constraint if exists feedback_message_len;
alter table public.feedback add  constraint feedback_message_len
  check (char_length(message) between 1 and 2000);

alter table public.feedback enable row level security;

drop policy if exists "feedback_auth_insert" on public.feedback;
create policy "feedback_auth_insert"
  on public.feedback
  for insert
  to authenticated
  with check (char_length(message) between 1 and 2000);

select policyname, roles, cmd from pg_policies
where schemaname = 'public' and tablename = 'feedback';
