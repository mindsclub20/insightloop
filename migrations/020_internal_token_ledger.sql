-- 020_internal_token_ledger.sql
-- Internal Anvesh credits, separate from the cash wallet/withdrawal system.
create table if not exists public.token_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_tokens bigint not null default 0 check (balance_tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid references public.profiles(id) on delete set null,
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  amount_tokens bigint not null check (amount_tokens > 0),
  transaction_type text not null check (transaction_type in ('ADMIN_GRANT','BUSINESS_TRANSFER')),
  idempotency_key text not null unique,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists token_transactions_recipient_created_idx on public.token_transactions(recipient_user_id, created_at desc);
create index if not exists token_transactions_sender_created_idx on public.token_transactions(sender_user_id, created_at desc);
alter table public.token_wallets enable row level security;
alter table public.token_transactions enable row level security;
revoke all on public.token_wallets from anon, authenticated;
revoke all on public.token_transactions from anon, authenticated;
grant select on public.token_wallets to authenticated;
grant select on public.token_transactions to authenticated;
drop policy if exists token_wallet_read_own on public.token_wallets;
create policy token_wallet_read_own on public.token_wallets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists token_transaction_read_involved on public.token_transactions;
create policy token_transaction_read_involved on public.token_transactions for select to authenticated using (recipient_user_id = (select auth.uid()) or sender_user_id = (select auth.uid()));

create or replace function public.get_my_token_wallet()
returns table (user_id uuid, balance_tokens bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  insert into public.token_wallets(user_id) values (v_uid) on conflict (user_id) do nothing;
  return query select w.user_id, w.balance_tokens from public.token_wallets w where w.user_id = v_uid;
end; $$;

create or replace function public.get_my_token_transactions()
returns table (id uuid, sender_user_id uuid, recipient_user_id uuid, amount_tokens bigint, transaction_type text, note text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  return query select t.id, t.sender_user_id, t.recipient_user_id, t.amount_tokens, t.transaction_type, t.note, t.created_at
    from public.token_transactions t where t.sender_user_id = v_uid or t.recipient_user_id = v_uid order by t.created_at desc limit 100;
end; $$;

create or replace function public.admin_grant_tokens(p_business_user_id uuid, p_amount_tokens bigint, p_idempotency_key text, p_note text default null)
returns table (user_id uuid, balance_tokens bigint, transaction_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid(); v_balance bigint; v_tx uuid;
begin
  if v_admin is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_admin and p.role in ('ADMIN','SUPER_ADMIN')) then raise exception 'Admin access required'; end if;
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

create or replace function public.business_transfer_tokens(p_participant_user_id uuid, p_amount_tokens bigint, p_idempotency_key text, p_note text default null)
returns table (sender_balance_tokens bigint, recipient_balance_tokens bigint, transaction_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sender uuid := auth.uid(); v_sender_balance bigint; v_recipient_balance bigint; v_tx uuid;
begin
  if v_sender is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_sender and p.role = 'BUSINESS' and p.status = 'ACTIVE') then raise exception 'Only active business accounts can allocate tokens'; end if;
  if not exists (select 1 from public.businesses b left join public.business_members bm on bm.business_id = b.id where b.owner_user_id = v_sender or bm.user_id = v_sender) then raise exception 'No business membership found'; end if;
  if p_participant_user_id = v_sender then raise exception 'Cannot transfer tokens to the same account'; end if;
  if p_amount_tokens is null or p_amount_tokens < 1 or p_amount_tokens > 1000000000 then raise exception 'Enter a token amount between 1 and 1,000,000,000'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception 'A valid idempotency key is required'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_participant_user_id and p.role = 'USER' and p.status = 'ACTIVE') then raise exception 'Choose an active participant account'; end if;
  if exists (select 1 from public.token_transactions t where t.idempotency_key = p_idempotency_key) then raise exception 'This transfer has already been processed'; end if;
  insert into public.token_wallets(user_id) values (v_sender) on conflict (user_id) do nothing;
  insert into public.token_wallets(user_id) values (p_participant_user_id) on conflict (user_id) do nothing;
  select w.balance_tokens into v_sender_balance from public.token_wallets w where w.user_id = v_sender for update;
  if v_sender_balance < p_amount_tokens then raise exception 'Insufficient token balance'; end if;
  update public.token_wallets w set balance_tokens = w.balance_tokens - p_amount_tokens, updated_at = now() where w.user_id = v_sender returning w.balance_tokens into v_sender_balance;
  update public.token_wallets w set balance_tokens = w.balance_tokens + p_amount_tokens, updated_at = now() where w.user_id = p_participant_user_id returning w.balance_tokens into v_recipient_balance;
  insert into public.token_transactions(sender_user_id, recipient_user_id, amount_tokens, transaction_type, idempotency_key, note)
    values (v_sender, p_participant_user_id, p_amount_tokens, 'BUSINESS_TRANSFER', p_idempotency_key, nullif(trim(p_note), '')) returning id into v_tx;
  return query select v_sender_balance, v_recipient_balance, v_tx;
end; $$;

create or replace function public.admin_list_token_accounts()
returns table (user_id uuid, full_name text, role text, business_name text, balance_tokens bigint, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (select 1 from public.profiles p where p.id = v_admin and p.role in ('ADMIN','SUPER_ADMIN')) then raise exception 'Admin access required'; end if;
  return query select p.id, p.full_name, p.role::text, b.legal_name, coalesce(w.balance_tokens, 0), p.created_at
    from public.profiles p left join public.businesses b on b.owner_user_id = p.id left join public.token_wallets w on w.user_id = p.id
    where p.role in ('BUSINESS','USER') order by p.created_at desc;
end; $$;

create or replace function public.admin_list_token_transactions()
returns table (id uuid, sender_user_id uuid, recipient_user_id uuid, amount_tokens bigint, transaction_type text, note text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (select 1 from public.profiles p where p.id = v_admin and p.role in ('ADMIN','SUPER_ADMIN')) then raise exception 'Admin access required'; end if;
  return query select t.id, t.sender_user_id, t.recipient_user_id, t.amount_tokens, t.transaction_type, t.note, t.created_at from public.token_transactions t order by t.created_at desc limit 200;
end; $$;

revoke all on function public.get_my_token_wallet() from public, anon;
revoke all on function public.get_my_token_transactions() from public, anon;
revoke all on function public.admin_grant_tokens(uuid,bigint,text,text) from public, anon;
revoke all on function public.business_transfer_tokens(uuid,bigint,text,text) from public, anon;
revoke all on function public.admin_list_token_accounts() from public, anon;
revoke all on function public.admin_list_token_transactions() from public, anon;
grant execute on function public.get_my_token_wallet() to authenticated;
grant execute on function public.get_my_token_transactions() to authenticated;
grant execute on function public.admin_grant_tokens(uuid,bigint,text,text) to authenticated;
grant execute on function public.business_transfer_tokens(uuid,bigint,text,text) to authenticated;
grant execute on function public.admin_list_token_accounts() to authenticated;
grant execute on function public.admin_list_token_transactions() to authenticated;
