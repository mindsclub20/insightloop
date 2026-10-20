-- 023_first_time_admin_bootstrap.sql
-- Atomic, single-use first-admin activation. Only the Supabase service role may execute it.
create or replace function public.bootstrap_first_token_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  if p_user_id is null then
    raise exception 'A valid account is required';
  end if;

  if exists (select 1 from public.token_admin_allowlist where enabled = true)
     or exists (select 1 from public.profiles where role in ('ADMIN', 'SUPER_ADMIN')) then
    raise exception 'First admin is already configured';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and status = 'ACTIVE'
  ) then
    raise exception 'An active profile is required';
  end if;

  update public.profiles set role = 'ADMIN' where id = p_user_id;
  if not found then
    raise exception 'An Anvesh profile is required';
  end if;

  insert into public.token_admin_allowlist(user_id, enabled) values (p_user_id, true);
end;
$$;

revoke all on function public.bootstrap_first_token_admin(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_first_token_admin(uuid) to service_role;
