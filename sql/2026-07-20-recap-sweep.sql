-- Server-side gig-recap sweeper: dedupe column + hourly schedule
-- Run: 2026-07-20, Supabase SQL editor, project SetQue (setque-live), role postgres
--
-- Makes the 6-hour-inactivity recap fire even when the performer's dashboard is
-- closed. Prereqs, in order:
--   1. Deploy the gig-recap-sweeper edge function.
--   2. Set its secrets: RESEND_API_KEY, EMAIL_FROM, SWEEP_SECRET (any long random
--      string), plus the platform-provided SUPABASE_URL / SERVICE_ROLE key.
--   3. Paste that SAME SWEEP_SECRET into <SWEEP_SECRET> below, then run this.
--
-- Idempotent (safe to re-run; it reschedules cleanly).

-- Dedupe flag shared with the client (also in the apply-all bundle).
alter table public.artist_settings add column if not exists recap_sent_session text;

-- Schedulers.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace any prior schedule, then (re)create the hourly sweep.
do $$
begin
  perform cron.unschedule('liveque-recap-sweep');
exception when others then null;
end $$;

select cron.schedule('liveque-recap-sweep', '0 * * * *', $job$
  select net.http_post(
    url     := 'https://jttswydixqeyyqvcohnq.supabase.co/functions/v1/gig-recap-sweeper',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-secret', '<SWEEP_SECRET>')
  );
$job$);

-- Confirm the job exists.
select jobname, schedule, active from cron.job where jobname = 'liveque-recap-sweep';
