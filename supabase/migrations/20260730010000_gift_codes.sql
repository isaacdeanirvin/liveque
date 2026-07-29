-- Gift codes: hand Pro to someone with a word instead of a charge.
-- Codes are validated and redeemed ONLY by the gift-redeem edge function
-- (service role); RLS is enabled with no client policies, so the code list
-- is unreadable and unguessable from the browser. Redemptions are unique
-- per (code, artist) so a code can't be farmed by one account.

create table if not exists public.gift_codes (
  code        text primary key,
  grants      text not null default 'pro_lifetime',
  max_uses    integer not null default 1,
  uses        integer not null default 0,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.gift_codes enable row level security;

create table if not exists public.gift_redemptions (
  code        text not null references public.gift_codes(code),
  artist_id   uuid not null,
  redeemed_at timestamptz not null default now(),
  primary key (code, artist_id)
);
alter table public.gift_redemptions enable row level security;

-- Isaac's founder code: lifetime Pro, effectively unlimited hand-outs.
insert into public.gift_codes (code, grants, max_uses, note)
values ('IRVIN', 'pro_lifetime', 100000, 'Founder code - Isaac Irvin')
on conflict (code) do nothing;
