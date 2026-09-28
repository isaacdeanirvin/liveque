-- MicQue v4: (1) musician mailing list, kept in its own table that the public can NEVER read;
-- (2) "still here?" confirmation when on deck, the one thing the no-show data says to ship.

-- ---------- Mailing list ----------
create table if not exists public.mic_contacts (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.mic_rooms(id) on delete cascade,
  signup_id   uuid references public.mic_signups(id) on delete set null,
  name        text,
  email       text not null check (position('@' in email) > 1 and char_length(email) <= 120),
  consented_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (room_id, email)
);
alter table public.mic_contacts enable row level security;
-- anon may INSERT its own email at sign-up; nobody but the service role can read the list.
drop policy if exists mic_contacts_insert on public.mic_contacts;
create policy mic_contacts_insert on public.mic_contacts for insert to anon, authenticated with check (true);
revoke select, update, delete on public.mic_contacts from anon, authenticated;
revoke insert on public.mic_contacts from anon, authenticated;
grant insert (room_id, signup_id, name, email) on public.mic_contacts to anon, authenticated;

create or replace function public.mic_clean_contact()
returns trigger language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  new.name  := left(trim(coalesce(new.name,'')), 60);
  return new;
end $$;
drop trigger if exists mic_contacts_clean on public.mic_contacts;
create trigger mic_contacts_clean before insert on public.mic_contacts for each row execute function public.mic_clean_contact();

-- ---------- On-deck confirmation ----------
alter table public.mic_signups add column if not exists confirmed_at timestamptz;
-- A performer's phone may only flip this one column, and only while they are on deck or up.
drop policy if exists mic_signups_confirm on public.mic_signups;
create policy mic_signups_confirm on public.mic_signups for update to anon, authenticated
  using (status in ('on_deck','now')) with check (status in ('on_deck','now'));
grant update (confirmed_at) on public.mic_signups to anon, authenticated;
