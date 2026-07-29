-- Skins + Pro rail.
--
-- skin: which of the twelve genre skins the performer's fan page wears.
-- founding: beachhead-era accounts get every skin free, forever (the LA
--   Founding Artist perk); defaults true now, flip the default when the
--   home room tips.
-- pro_*: the $4.99 subscription state, synced from Stripe by the
--   pro-status edge function. This is Stripe BILLING (platform revenue),
--   a fully separate money graph from the Connect tip path - tips never
--   route through LiveQue and Pro never touches the tip rails.

alter table public.artist_settings add column if not exists skin text not null default 'default';
alter table public.artist_settings add column if not exists founding boolean not null default true;
alter table public.artist_settings add column if not exists pro_active boolean not null default false;
alter table public.artist_settings add column if not exists pro_plan text;
alter table public.artist_settings add column if not exists pro_customer_id text;
alter table public.artist_settings add column if not exists pro_subscription_id text;
alter table public.artist_settings add column if not exists pro_period_end timestamptz;
