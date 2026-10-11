-- migrations/006_reward_functions.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES.
--
-- Adds the two atomic wallet-mutation functions the submit-survey-response
-- Edge Function needs for its "auto-confirm a clean response's reward"
-- path. These are DELIBERATELY NOT granted to `authenticated`/`anon` -
-- callable only by the service role (which Edge Functions use, and which
-- bypasses grants entirely) - because unlike 004's admin_confirm_reward()
-- and admin_forfeit_reward() (which check current_user_role() = ADMIN
-- internally and so are safe to grant to any authenticated user), these two
-- have NO caller-identity check at all. That's fine ONLY because nothing
-- except a trusted, already-authorization-checked Edge Function can reach
-- them. If you ever grant these to `authenticated`, you have just given
-- every participant the ability to confirm an arbitrary reward transaction
-- by guessing a response_id - do not do that.
--
-- Both use a single atomic UPDATE with an arithmetic expression
-- (balance_paise = balance_paise + x), not a read-then-write from
-- application code, which is the specific race condition flagged as a
-- caveat in submit-survey-response/index.ts before this migration existed
-- to fix it properly.

create or replace function create_pending_reward(p_user_id uuid, p_response_id uuid, p_amount_paise bigint)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet wallets;
  v_tx wallet_transactions;
  v_key text := 'reward:' || p_response_id;
begin
  select * into v_tx from wallet_transactions where idempotency_key = v_key;
  if v_tx is not null then
    return v_tx; -- idempotent: a retried request must not double-create
  end if;

  select * into v_wallet from wallets where user_id = p_user_id for update;
  if v_wallet is null then
    raise exception 'No wallet found for user %', p_user_id;
  end if;

  insert into wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key)
  values (gen_random_uuid(), v_wallet.id, 'SURVEY_REWARD', p_amount_paise, 'PENDING', p_response_id, v_key)
  returning * into v_tx;

  update wallets set pending_paise = pending_paise + p_amount_paise, updated_at = now() where id = v_wallet.id;

  return v_tx;
end;
$$;
revoke all on function create_pending_reward(uuid, uuid, bigint) from public, anon, authenticated;

create or replace function confirm_pending_reward_internal(p_response_id uuid)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions;
begin
  select * into v_tx from wallet_transactions where idempotency_key = 'reward:' || p_response_id for update;
  if v_tx is null then raise exception 'No pending reward transaction for response %', p_response_id; end if;
  if v_tx.status = 'CONFIRMED' then return v_tx; end if; -- idempotent

  update wallet_transactions set status = 'CONFIRMED', updated_at = now() where id = v_tx.id;
  update wallets
    set balance_paise = balance_paise + v_tx.amount_paise,
        pending_paise = pending_paise - v_tx.amount_paise,
        updated_at = now()
  where id = v_tx.wallet_id;

  select * into v_tx from wallet_transactions where id = v_tx.id;
  return v_tx;
end;
$$;
revoke all on function confirm_pending_reward_internal(uuid) from public, anon, authenticated;

-- Belt-and-suspenders: explicitly grant to service_role, even though the
-- service role bypasses grant checks in most Supabase configurations - this
-- makes the intent readable rather than relying on that behavior silently.
grant execute on function create_pending_reward(uuid, uuid, bigint) to service_role;
grant execute on function confirm_pending_reward_internal(uuid) to service_role;
