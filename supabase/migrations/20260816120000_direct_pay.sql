-- Direct-pay pivot: money goes straight to the musician's own Venmo/PayPal,
-- LiveQue never processes it. A per-request code rides in the payment note; a
-- confirmation (PayPal webhook or parsed Venmo receipt) matches the code and
-- flips the request paid. No card processor, no platform liability.

-- Per-musician payout handles + which rail is primary.
alter table public.artist_settings add column if not exists venmo_handle text;
alter table public.artist_settings add column if not exists paypal_handle text;
alter table public.artist_settings add column if not exists pay_provider text;      -- 'venmo' | 'paypal'
-- PayPal auto-confirm (webhook) connection; null until the musician connects.
alter table public.artist_settings add column if not exists paypal_merchant_id text;
alter table public.artist_settings add column if not exists paypal_connected boolean not null default false;

-- The request carries the note code and its own paid state, independent of
-- the legacy Stripe columns.
alter table public.requests add column if not exists pay_code text;
alter table public.requests add column if not exists pay_provider text;
alter table public.requests add column if not exists paid boolean not null default false;
alter table public.requests add column if not exists paid_at timestamptz;
alter table public.requests add column if not exists paid_amount integer;

-- Codes must be unique per artist so an inbound receipt maps to exactly one
-- request. Partial index: only where a code exists.
create unique index if not exists requests_pay_code_uniq
  on public.requests (artist_id, pay_code) where pay_code is not null;

-- Inbound payment receipts (PayPal webhook or forwarded Venmo email), logged
-- raw before matching so nothing is lost if parsing changes. Service-role only.
create table if not exists public.pay_receipts (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  provider    text,
  amount      integer,
  note_code   text,
  payer       text,
  matched_request uuid,
  raw         jsonb
);
alter table public.pay_receipts enable row level security;
create index if not exists pay_receipts_code on public.pay_receipts (note_code, at desc);
