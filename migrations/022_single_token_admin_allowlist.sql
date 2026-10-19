-- 022_single_token_admin_allowlist.sql
-- Keep the token-granting panel restricted to one explicitly designated account.
create table if not exists public.token_admin_allowlist (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists token_admin_allowlist_single_enabled
  on public.token_admin_allowlist ((enabled)) where enabled = true;
alter table public.token_admin_allowlist enable row level security;
revoke all on public.token_admin_allowlist from anon, authenticated;

create or replace function public.is_token_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.token_admin_allowlist a where a.user_id = auth.uid() and a.enabled = true);
$$;
revoke all on function public.is_token_admin() from public, anon;
grant execute on function public.is_token_admin() to authenticated;

-- The grant/list functions now check the allowlist instead of the general admin role.
-- See migrations/020_internal_token_ledger.sql for their full implementation.
