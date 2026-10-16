-- 022_atomic_reward_functions.sql
-- Atomic, idempotent wallet reward operations used by submit-survey-response.
-- Reward creation/confirmation is service-role-only; the Edge Functions enforce
-- participant eligibility and admin review. No real money is moved here.

create or replace function public.create_pending_reward(
  p_user_id uuid,
  p_response_id uuid,
  p_amount_paise bigint
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.survey_responses%rowtype;
  v_project public.research_projects%rowtype;
  v_wallet public.wallets%rowtype;
  v_tx public.wallet_transactions%rowtype;
  v_key text := 'reward:' || p_response_id::text;
begin
  if p_user_id is null or p_response_id is null then
    raise exception 'User and response are required';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Reward amount must be positive';
  end if;

  select * into v_response
  from public.survey_responses
  where id = p_response_id
  for update;
  if not found then raise exception 'Response not found'; end if;
  if v_response.user_id <> p_user_id then
    raise exception 'Response does not belong to the requested participant';
  end if;
  if v_response.status not in ('VALID'::public.response_status, 'FLAGGED'::public.response_status) then
    raise exception 'Response is not eligible for a pending reward';
  end if;

  select * into v_project
  from public.research_projects
  where id = v_response.research_project_id;
  if not found then raise exception 'Survey not found'; end if;
  if v_project.reward_per_response_paise <> p_amount_paise then
    raise exception 'Reward amount does not match the survey configuration';
  end if;
  if not exists (
    select 1 from public.business_payments bp
    where bp.research_project_id = v_response.research_project_id
      and bp.status = 'SUCCESS'::public.payment_status
  ) then
    raise exception 'Survey reward funding is not confirmed';
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;
  if not found then raise exception 'No wallet found for participant'; end if;

  select * into v_tx
  from public.wallet_transactions
  where idempotency_key = v_key
  for update;
  if found then
    if v_tx.wallet_id <> v_wallet.id
       or v_tx.amount_paise <> p_amount_paise
       or v_tx.reference_id <> p_response_id
       or v_tx.type <> 'SURVEY_REWARD'::public.tx_type then
      raise exception 'Idempotency key conflicts with an existing reward';
    end if;
    return v_tx;
  end if;

  insert into public.wallet_transactions
    (wallet_id, type, amount_paise, status, reference_id, idempotency_key)
  values
    (v_wallet.id, 'SURVEY_REWARD'::public.tx_type, p_amount_paise,
     'PENDING'::public.tx_status, p_response_id, v_key)
  returning * into v_tx;

  update public.wallets
  set pending_paise = pending_paise + p_amount_paise,
      updated_at = now()
  where id = v_wallet.id;

  return v_tx;
end;
$$;

revoke all on function public.create_pending_reward(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.create_pending_reward(uuid, uuid, bigint) to service_role;

create or replace function public.confirm_pending_reward_internal(p_response_id uuid)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.survey_responses%rowtype;
  v_tx public.wallet_transactions%rowtype;
  v_wallet public.wallets%rowtype;
begin
  if p_response_id is null then raise exception 'Response is required'; end if;

  select * into v_response from public.survey_responses where id = p_response_id for update;
  if not found then raise exception 'Response not found'; end if;
  if v_response.status <> 'VALID'::public.response_status then
    raise exception 'Only a valid response can have its reward confirmed';
  end if;
  if not exists (
    select 1 from public.business_payments bp
    where bp.research_project_id = v_response.research_project_id
      and bp.status = 'SUCCESS'::public.payment_status
  ) then
    raise exception 'Survey reward funding is not confirmed';
  end if;

  select * into v_tx from public.wallet_transactions
  where idempotency_key = 'reward:' || p_response_id::text
  for update;
  if not found then raise exception 'No reward transaction exists for this response'; end if;
  if v_tx.status = 'CONFIRMED'::public.tx_status then return v_tx; end if;
  if v_tx.status <> 'PENDING'::public.tx_status then
    raise exception 'Only a pending reward can be confirmed';
  end if;

  select * into v_wallet from public.wallets where id = v_tx.wallet_id for update;
  if not found then raise exception 'Reward wallet not found'; end if;
  if v_wallet.pending_paise < v_tx.amount_paise then
    raise exception 'Wallet pending balance is inconsistent; reconciliation is required';
  end if;

  update public.wallets
  set balance_paise = balance_paise + v_tx.amount_paise,
      pending_paise = pending_paise - v_tx.amount_paise,
      updated_at = now()
  where id = v_wallet.id;

  update public.wallet_transactions
  set status = 'CONFIRMED'::public.tx_status, updated_at = now()
  where id = v_tx.id
  returning * into v_tx;

  return v_tx;
end;
$$;

revoke all on function public.confirm_pending_reward_internal(uuid) from public, anon, authenticated;
grant execute on function public.confirm_pending_reward_internal(uuid) to service_role;

create or replace function public.admin_confirm_reward(p_response_id uuid)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.survey_responses%rowtype;
begin
  select * into v_response from public.survey_responses where id = p_response_id for update;
  if not found then raise exception 'Response not found'; end if;
  if v_response.status <> 'VALID'::public.response_status then
    raise exception 'Response must be marked VALID before reward confirmation';
  end if;
  if not exists (
    select 1 from public.response_quality rq
    where rq.response_id = p_response_id and rq.review_decision = 'VALID'
  ) then
    raise exception 'A recorded VALID quality review is required';
  end if;
  return public.confirm_pending_reward_internal(p_response_id);
end;
$$;
revoke all on function public.admin_confirm_reward(uuid) from public, anon, authenticated;
grant execute on function public.admin_confirm_reward(uuid) to service_role;

create or replace function public.admin_forfeit_reward(p_response_id uuid)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.survey_responses%rowtype;
  v_tx public.wallet_transactions%rowtype;
  v_wallet public.wallets%rowtype;
begin
  select * into v_response from public.survey_responses where id = p_response_id for update;
  if not found then raise exception 'Response not found'; end if;
  if v_response.status <> 'REJECTED'::public.response_status then
    raise exception 'Response must be marked REJECTED before reward forfeiture';
  end if;
  if not exists (
    select 1 from public.response_quality rq
    where rq.response_id = p_response_id and rq.review_decision = 'REJECTED'
  ) then
    raise exception 'A recorded REJECTED quality review is required';
  end if;

  select * into v_tx from public.wallet_transactions
  where idempotency_key = 'reward:' || p_response_id::text
  for update;
  if not found then raise exception 'No reward transaction exists for this response'; end if;
  if v_tx.status = 'FAILED'::public.tx_status then return v_tx; end if;
  if v_tx.status <> 'PENDING'::public.tx_status then
    raise exception 'Only a pending reward can be forfeited';
  end if;

  select * into v_wallet from public.wallets where id = v_tx.wallet_id for update;
  if not found then raise exception 'Reward wallet not found'; end if;
  if v_wallet.pending_paise < v_tx.amount_paise then
    raise exception 'Wallet pending balance is inconsistent; reconciliation is required';
  end if;

  update public.wallets
  set pending_paise = pending_paise - v_tx.amount_paise,
      updated_at = now()
  where id = v_wallet.id;

  update public.wallet_transactions
  set status = 'FAILED'::public.tx_status, notes = 'Forfeited after documented response review',
      updated_at = now()
  where id = v_tx.id
  returning * into v_tx;

  return v_tx;
end;
$$;
revoke all on function public.admin_forfeit_reward(uuid) from public, anon, authenticated;
grant execute on function public.admin_forfeit_reward(uuid) to service_role;
