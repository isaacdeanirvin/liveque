-- MicQue: the host can ping one performer's phone ("Mark is calling you").
-- Only mic-host (service role) writes it; the performer's page watches its own row over realtime
-- and buzzes / chimes / takes over the screen. Anon can read it (mic_signups select is table-wide).
alter table public.mic_signups add column if not exists pinged_at timestamptz;
