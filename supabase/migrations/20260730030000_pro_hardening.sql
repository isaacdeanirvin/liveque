-- Pro rail hardening, from the adversarial review.
--
-- 1. Gift state gets its own columns (pro_gift, pro_gift_until) so gifted
--    Pro and paid subscriptions can never clobber each other's truth.
-- 2. gift_redeem_atomic(): redemption is one transaction - per-artist
--    unique insert + a row-locked uses counter, so max_uses cannot be
--    raced past and a duplicate redeem cannot double-count.
-- 3. protect_pro_columns trigger: entitlement and identity columns are
--    writable only by the service role. RLS lets an artist update their
--    own settings row, which previously meant a savvy user could set
--    pro_active=true from the browser console. Now client writes to
--    protected columns are silently reverted (update) or zeroed (insert).

alter table public.artist_settings add column if not exists pro_gift boolean not null default false;
alter table public.artist_settings add column if not exists pro_gift_until timestamptz;

create or replace function public.gift_redeem_atomic(p_code text, p_artist uuid)
returns text language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from gift_codes where code = p_code and active for update;
  if not found then return 'not_found'; end if;
  if g.uses >= g.max_uses then return 'exhausted'; end if;
  begin
    insert into gift_redemptions(code, artist_id) values (p_code, p_artist);
  exception when unique_violation then
    return 'already';
  end;
  update gift_codes set uses = uses + 1 where code = p_code;
  return g.grants;
end $$;
revoke execute on function public.gift_redeem_atomic(text, uuid) from public, anon, authenticated;

create or replace function public.protect_pro_columns()
returns trigger language plpgsql as $$
declare jwt_role text;
begin
  jwt_role := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  if jwt_role = 'service_role' then return new; end if;
  if tg_op = 'UPDATE' then
    new.pro_active := old.pro_active;
    new.pro_plan := old.pro_plan;
    new.pro_customer_id := old.pro_customer_id;
    new.pro_subscription_id := old.pro_subscription_id;
    new.pro_period_end := old.pro_period_end;
    new.pro_gift := old.pro_gift;
    new.pro_gift_until := old.pro_gift_until;
    new.founding := old.founding;
  else
    new.pro_active := false;
    new.pro_plan := null;
    new.pro_customer_id := null;
    new.pro_subscription_id := null;
    new.pro_period_end := null;
    new.pro_gift := false;
    new.pro_gift_until := null;
  end if;
  return new;
end $$;

drop trigger if exists protect_pro_columns_upd on public.artist_settings;
create trigger protect_pro_columns_upd before update on public.artist_settings
  for each row execute function public.protect_pro_columns();
drop trigger if exists protect_pro_columns_ins on public.artist_settings;
create trigger protect_pro_columns_ins before insert on public.artist_settings
  for each row execute function public.protect_pro_columns();
