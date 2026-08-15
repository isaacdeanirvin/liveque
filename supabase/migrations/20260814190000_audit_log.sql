-- Audit log: a permanent, append-only record of everything that touches money
-- or trust. Banks keep this so that after an incident there is a receipt, not
-- a memory. Tonight's fraud was reconstructed by hand from scattered tables;
-- this makes the next one a single query.
--
-- Written only by the service role (edge functions). No client can read or
-- write it: RLS is on with zero policies, and there is a hard trigger blocking
-- UPDATE and DELETE so even a compromised service key cannot rewrite history.

create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,                 -- artist_id, 'system', or 'admin'
  action     text not null,        -- 'login', 'tip_created', 'account_frozen', ...
  target     text,                 -- the account/object acted on
  ip         text,
  detail     jsonb
);
alter table public.audit_log enable row level security;
create index if not exists audit_log_at on public.audit_log (at desc);
create index if not exists audit_log_action on public.audit_log (action, at desc);

-- Append-only: history cannot be edited or erased, by anyone.
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Helper the edge functions call. security definer so it writes regardless of
-- the caller's role, but it is revoked from anon/authenticated so only trusted
-- server code (service role) can invoke it.
create or replace function public.audit(
  p_actor text, p_action text, p_target text, p_ip text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor, action, target, ip, detail)
  values (p_actor, p_action, p_target, p_ip, p_detail);
end $$;
revoke execute on function public.audit(text, text, text, text, jsonb) from public, anon, authenticated;
