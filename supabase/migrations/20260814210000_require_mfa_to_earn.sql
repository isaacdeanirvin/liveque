-- Force 2FA on every account that takes money. "No leaks": the check is
-- server-side and authoritative, not a client prompt that can be skipped.
--
-- has_verified_mfa(artist) answers, from the auth system itself, whether that
-- performer has a verified authenticator enrolled. SECURITY DEFINER so it can
-- read auth.mfa_factors; revoked from anon/authenticated so only trusted server
-- code (the edge functions, service role) can call it. The tip and onboarding
-- functions consult it before any money moves.

create or replace function public.has_verified_mfa(p_artist uuid)
returns boolean
language sql
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
      from auth.mfa_factors f
      join public.artists a on a.auth_user_id = f.user_id
     where a.id = p_artist
       and f.status = 'verified'
  );
$$;
revoke execute on function public.has_verified_mfa(uuid) from public, anon, authenticated;
