-- F1: Tip integrity — close the fake-tip hole
-- Run: 2026-07-19, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- Problem (as stated in the kickoff): the anon INSERT policy on public.requests
-- did not constrain column values, so anyone holding the page-source anon key
-- could insert tip_amount: 999 and jump the queue without paying.
--
-- Finding on execution: the live anon INSERT policy already carried a
-- tip_amount/status check (a crafted tip_amount:50 insert was rejected before
-- this ran), so tip integrity was likely closed in a prior lockdown (v6.9.7).
-- This migration re-asserts it under a clean, explicit name and proves it.
--
-- Fix: audience (anon) inserts must be free and queued. Real tips are inserted
-- only by stripe-webhook using the service role, which bypasses RLS entirely.
-- After this, Stripe is the only path to queue priority.
--
-- Performer path: public.requests already has requests_performer_all (FOR ALL,
-- scoped through the artists auth bridge: artist_id in (select id from artists
-- where auth_user_id = auth.uid())). That ALL policy already covers the
-- performer's Manual Add insert (quickAddToQueue in index.html), so no separate
-- authenticated INSERT policy is needed. The guard in step 4 only creates one if
-- that ALL coverage is somehow absent, keeping this migration safe to re-run in
-- any environment.
--
-- This script is idempotent: re-running it converges public.requests to exactly
-- three policies — requests_performer_all (authenticated ALL),
-- anon_insert_free_queued_only (anon INSERT), requests_anon_select (anon SELECT).

-- 1. Drop every INSERT policy on public.requests that applies to anon
--    (directly or via public). Name-agnostic. Leaves the authenticated ALL
--    policy untouched (it is cmd = 'ALL', roles = {authenticated}).
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'requests'
      and cmd        = 'INSERT'
      and (roles @> array['anon'::name] or roles @> array['public'::name])
  loop
    execute format('drop policy %I on public.requests', p.policyname);
  end loop;
end $$;

-- 2. Audience inserts: free and queued only. Stripe is the only path to priority.
create policy "anon_insert_free_queued_only"
  on public.requests
  for insert
  to anon
  with check (tip_amount = 0 and status = 'queued');

-- 3. Remove any redundant authenticated INSERT policy. requests_performer_all
--    (FOR ALL) already grants performers insert on their own queue; a separate
--    performer_insert_own_queue would be a duplicate. (An earlier run of this
--    migration created one because its guard tested cmd = 'INSERT' and missed
--    the cmd = 'ALL' policy; step 4's guard is corrected below.)
drop policy if exists "performer_insert_own_queue" on public.requests;

-- 4. Safety net: only if NO authenticated policy already permits insert
--    (neither a dedicated INSERT policy nor a FOR ALL policy), create a scoped
--    performer INSERT policy so Manual Add cannot break. No-op when
--    requests_performer_all is present.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'requests'
      and cmd        in ('INSERT', 'ALL')
      and roles @> array['authenticated'::name]
  ) then
    create policy "performer_insert_own_queue"
      on public.requests
      for insert
      to authenticated
      with check (
        tip_amount = 0
        and status = 'queued'
        and artist_id in (select id from public.artists where auth_user_id = auth.uid())
      );
  end if;
end $$;

-- 5. Show resulting policies on requests (appears as the editor result).
--    Expect exactly three rows.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename  = 'requests'
order by cmd, policyname;
