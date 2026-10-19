-- 022_single_token_admin_allowlist.sql
-- Token grants are reserved for one explicitly designated account.
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
  select auth.uid() is not null and exists (
    select 1 from public.token_admin_allowlist a where a.user_id = auth.uid() and a.enabled = true
  );
$$;
revoke all on function public.is_token_admin() from public, anon;
grant execute on function public.is_token_admin() to authenticated;

create or replace function public.admin_grant_tokens(p_business_user_id uuid, p_amount_tokens bigint, p_idempotency_key text, p_note text default null)
returns table (user_id uuid, balance_tokens bigint, transaction_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid(); v_balance bigint; v_tx uuid;
begin
  if v_admin is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.token_admin_allowlist a where a.user_id = v_admin and a.enabled) then raise exception 'Authorized token administrator required'; end if;
  if p_amount_tokens is null or p_amount_tokens < 1 or p_amount_tokens > 1000000000 then raise exception 'Enter a token amount between 1 and 1,000,000,000'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'A valid idempotency key is required'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_business_user_id and p.role = 'BUSINESS' and p.status = 'ACTIVE') then raise exception 'Choose an active business account'; end if;
  if exists (select 1 from public.token_transactions t where t.idempotency_key = p_idempotency_key) then raise exception 'This grant has already been processed'; end if;
  insert into public.token_wallets(user_id) values (p_business_user_id) on conflict (user_id) do nothing;
  update public.token_wallets w set balance_tokens = w.balance_tokens + p_amount_tokens, updated_at = now() where w.user_id = p_business_user_id returning w.balance_tokens into v_balance;
  insert into public.token_transactions(sender_user_id, recipient_user_id, amount_tokens, transaction_type, idempotency_key, note)
    values (null, p_business_user_id, p_amount_tokens, 'ADMIN_GRANT', p_idempotency_key, nullif(trim(p_note), '')) returning id into v_tx;
  insert into public.admin_actions(admin_id, action_type, target_type, target_id, notes)
    values (v_admin, 'TOKEN_GRANT', 'USER', p_business_user_id, 'Granted ' || p_amount_tokens || ' internal tokens. Transaction ' || v_tx::text || case when nullif(trim(p_note), '') is null then '' else '. ' || left(trim(p_note), 500) end);
  return query select p_business_user_id, v_balance, v_tx;
end; $$;

create or replace function public.admin_list_token_accounts()
returns table (user_id uuid, full_name text, role text, business_name text, balance_tokens bigint, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (select 1 from public.token_admin_allowlist a where a.user_id = v_admin and a.enabled) then raise exception 'Authorized token administrator required'; end if;
  return query select p.id, p.full_name, p.role::text, b.legal_name, coalesce(w.balance_tokens, 0), p.created_at
    from public.profiles p left join public.businesses b on b.owner_user_id = p.id left join public.token_wallets w on w.user_id = p.id
    where p.role in ('BUSINESS','USER') order by p.created_at desc;
end; $$;

create or replace function public.admin_list_token_transactions()
returns table (id uuid, sender_user_id uuid, recipient_user_id uuid, amount_tokens bigint, transaction_type text, note text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (select 1 from public.token_admin_allowlist a where a.user_id = v_admin and a.enabled) then raise exception 'Authorized token administrator required'; end if;
  return query select t.id, t.sender_user_id, t.recipient_user_id, t.amount_tokens, t.transaction_type, t.note, t.created_at from public.token_transactions t order by t.created_at desc limit 200;
end; $$;
