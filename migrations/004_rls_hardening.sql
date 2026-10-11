-- migrations/004_rls_hardening.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES.
--
-- Supersedes two specific pieces of 002_rls_policies.sql without editing
-- that file (it stays as a historical record of what was originally
-- shipped). Run 001 -> 002 -> 003 -> 004 in order on a fresh database;
-- on an existing one, 004 is idempotent (DROP POLICY IF EXISTS / CREATE OR
-- REPLACE) and safe to re-run.

-- ============================================================
-- FIX 1: question_options visibility was a placeholder in 002.
-- ============================================================
-- The original policy was `question_id in (select id from survey_questions)`
-- — i.e. every authenticated client could read every option of every
-- question on every study, including DRAFT studies belonging to a business
-- they have no relationship to. It relied on a comment promising the
-- application layer would filter it, which is exactly the pattern this
-- whole migration project exists to eliminate.
--
-- Corrected policy: an option is visible under the same rule as its parent
-- question - i.e. it follows research_projects visibility (owning business
-- member, or ACTIVE-and-participant, or admin).
drop policy if exists "read options with question" on question_options;
create policy "read options with visible question" on question_options for select using (
  question_id in (
    select sq.id from survey_questions sq
    join research_projects rp on rp.id = sq.research_project_id
    where rp.business_id in (select business_id from business_members where user_id = auth.uid())
       or (rp.status = 'ACTIVE' and current_user_role() = 'USER')
  )
);
-- "admin full access options" policy from 002 is unaffected and still applies.

-- ============================================================
-- FIX 2: wallet_transactions and withdrawals must be written ONLY through
-- controlled, SECURITY DEFINER functions - never by a direct client INSERT
-- or UPDATE, even from the owning user.
-- ============================================================
-- 002 already gave `authenticated` no INSERT/UPDATE policy on
-- wallet_transactions (correct by omission), but relied on default-deny
-- rather than an explicit, self-documenting deny, and 002's own
-- "own withdrawals insert" policy DID allow a participant to insert a
-- withdrawals row directly - which meant a client could, in principle,
-- request an arbitrary amount_paise without going through the balance
-- check in application code, and a bug or a forked client could exploit
-- that gap. This migration removes that direct-insert path entirely.

-- Explicit, documented deny: no role except the table owner /
-- SECURITY DEFINER functions may write these tables directly.
revoke insert, update, delete on wallet_transactions from authenticated, anon;
revoke insert, update, delete on withdrawals from authenticated, anon;
revoke insert, update, delete on wallets from authenticated, anon;

-- Remove the too-permissive direct-insert policy from 002.
drop policy if exists "own withdrawals insert" on withdrawals;
-- SELECT-only policy from 002 ("own withdrawals read") is preserved as-is.

-- ---- Controlled function: request_withdrawal ----
-- Replaces direct client INSERT into withdrawals. Validates balance,
-- reserves funds, and writes both the withdrawals row and its paired
-- wallet_transactions row atomically, exactly mirroring the ordering fix
-- applied to src/lib/ledger.js (wallet_transactions row must exist before
-- withdrawals.ledger_transaction_id can reference it).
create or replace function request_withdrawal(p_amount_paise bigint, p_upi_id text)
returns withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet wallets;
  v_withdrawal withdrawals;
  v_tx_id uuid := gen_random_uuid();
  v_withdrawal_id uuid := gen_random_uuid();
begin
  if p_amount_paise < 10000 then
    raise exception 'Minimum withdrawal is 100 rupees';
  end if;

  select * into v_wallet from wallets where user_id = auth.uid() for update;
  if v_wallet is null then
    raise exception 'No wallet found for current user';
  end if;
  if v_wallet.balance_paise < p_amount_paise then
    raise exception 'Insufficient balance';
  end if;

  insert into wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key)
  values (v_tx_id, v_wallet.id, 'WITHDRAWAL', -p_amount_paise, 'PROCESSING', v_withdrawal_id, 'withdrawal:' || v_withdrawal_id);

  insert into withdrawals (id, user_id, amount_paise, upi_id, status, ledger_transaction_id)
  values (v_withdrawal_id, auth.uid(), p_amount_paise, p_upi_id, 'REQUESTED', v_tx_id)
  returning * into v_withdrawal;

  update wallets set balance_paise = balance_paise - p_amount_paise, updated_at = now() where id = v_wallet.id;

  return v_withdrawal;
end;
$$;

-- Only authenticated users may call it; the function body itself scopes
-- everything to auth.uid(), so there is no need for a matching RLS policy
-- granting table access - the function runs with the privileges of its
-- owner, not the caller.
revoke all on function request_withdrawal(bigint, text) from public;
grant execute on function request_withdrawal(bigint, text) to authenticated;

-- ---- Controlled function: confirm_reward / forfeit_reward ----
-- These are the ONLY paths that move a SURVEY_REWARD transaction out of
-- PENDING. Callable only by ADMIN/SUPER_ADMIN (for flagged-response review)
-- or by the survey-submission Edge Function acting as an elevated service
-- role for the auto-confirm-on-clean-response case (see PaymentService /
-- application docs - the Edge Function calls this using the service role,
-- which bypasses RLS by design and does not go through this grant at all;
-- this grant covers the admin-review path specifically).
create or replace function admin_confirm_reward(p_response_id uuid) returns wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_tx wallet_transactions;
begin
  if current_user_role() not in ('ADMIN', 'SUPER_ADMIN') then
    raise exception 'Only an admin may confirm a reward through this function';
  end if;

  select * into v_tx from wallet_transactions where idempotency_key = 'reward:' || p_response_id;
  if v_tx is null then raise exception 'No pending reward transaction for this response'; end if;
  if v_tx.status = 'CONFIRMED' then return v_tx; end if;

  update wallet_transactions set status = 'CONFIRMED', updated_at = now() where id = v_tx.id;
  update wallets set balance_paise = balance_paise + v_tx.amount_paise,
                      pending_paise = pending_paise - v_tx.amount_paise,
                      updated_at = now()
  where id = v_tx.wallet_id;

  select * into v_tx from wallet_transactions where id = v_tx.id;
  return v_tx;
end;
$$;
revoke all on function admin_confirm_reward(uuid) from public;
grant execute on function admin_confirm_reward(uuid) to authenticated; -- function body itself still gates by role

create or replace function admin_forfeit_reward(p_response_id uuid) returns wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_tx wallet_transactions;
begin
  if current_user_role() not in ('ADMIN', 'SUPER_ADMIN') then
    raise exception 'Only an admin may forfeit a reward through this function';
  end if;

  select * into v_tx from wallet_transactions where idempotency_key = 'reward:' || p_response_id;
  if v_tx is null then return null; end if;
  if v_tx.status != 'PENDING' then return v_tx; end if;

  update wallet_transactions set status = 'FAILED', updated_at = now() where id = v_tx.id;
  update wallets set pending_paise = pending_paise - v_tx.amount_paise, updated_at = now() where id = v_tx.wallet_id;

  select * into v_tx from wallet_transactions where id = v_tx.id;
  return v_tx;
end;
$$;
revoke all on function admin_forfeit_reward(uuid) from public;
grant execute on function admin_forfeit_reward(uuid) to authenticated;

-- ---- Controlled function: admin_mark_withdrawal_paid / admin_reject_withdrawal ----
create or replace function admin_mark_withdrawal_paid(p_withdrawal_id uuid) returns withdrawals
language plpgsql security definer set search_path = public as $$
declare
  v_w withdrawals;
begin
  if current_user_role() not in ('ADMIN', 'SUPER_ADMIN') then
    raise exception 'Only an admin may mark a withdrawal paid';
  end if;
  select * into v_w from withdrawals where id = p_withdrawal_id;
  if v_w is null then raise exception 'Withdrawal not found'; end if;
  if v_w.status = 'PAID' then return v_w; end if;
  if v_w.status not in ('REQUESTED', 'PROCESSING') then
    raise exception 'Cannot mark % withdrawal as paid', v_w.status;
  end if;

  update withdrawals set status = 'PAID', processed_by = auth.uid(), updated_at = now() where id = p_withdrawal_id returning * into v_w;
  update wallet_transactions set status = 'PAID', updated_at = now() where id = v_w.ledger_transaction_id;
  return v_w;
end;
$$;
revoke all on function admin_mark_withdrawal_paid(uuid) from public;
grant execute on function admin_mark_withdrawal_paid(uuid) to authenticated;

create or replace function admin_reject_withdrawal(p_withdrawal_id uuid, p_reason text) returns withdrawals
language plpgsql security definer set search_path = public as $$
declare
  v_w withdrawals;
begin
  if current_user_role() not in ('ADMIN', 'SUPER_ADMIN') then
    raise exception 'Only an admin may reject a withdrawal';
  end if;
  select * into v_w from withdrawals where id = p_withdrawal_id;
  if v_w is null then raise exception 'Withdrawal not found'; end if;
  if v_w.status in ('PAID', 'REJECTED') then return v_w; end if;

  update withdrawals set status = 'REJECTED', processed_by = auth.uid(), admin_notes = p_reason, updated_at = now() where id = p_withdrawal_id returning * into v_w;
  update wallet_transactions set status = 'FAILED', updated_at = now() where id = v_w.ledger_transaction_id;

  insert into wallet_transactions (id, wallet_id, type, amount_paise, status, reference_id, idempotency_key, notes)
  select gen_random_uuid(), w.id, 'WITHDRAWAL_REVERSAL', v_w.amount_paise, 'CONFIRMED', p_withdrawal_id, 'reversal:' || p_withdrawal_id, p_reason
  from wallets w where w.user_id = v_w.user_id;

  update wallets set balance_paise = balance_paise + v_w.amount_paise, updated_at = now() where user_id = v_w.user_id;
  return v_w;
end;
$$;
revoke all on function admin_reject_withdrawal(uuid, text) from public;
grant execute on function admin_reject_withdrawal(uuid, text) to authenticated;

-- ============================================================
-- FIX 3: authorization of WHO can move a research_projects status also
-- needs its own RLS policies (separate from the transition-shape trigger
-- in 003). 002's "business writes own DRAFT projects" already scopes
-- business updates to DRAFT only, which happens to prevent a business
-- from self-approving (APPROVED/ACTIVE are not DRAFT), but that was
-- incidental, not an explicit rule. Make it explicit here.
-- ============================================================
drop policy if exists "business writes own DRAFT projects" on research_projects;
create policy "business writes own DRAFT or SUBMITTED-cancel projects" on research_projects for update using (
  business_id in (select business_id from business_members where user_id = auth.uid())
  and status in ('DRAFT', 'SUBMITTED') -- a business may edit its own DRAFT, or cancel a DRAFT/SUBMITTED study; it can never touch ADMIN_REVIEW/APPROVED/ACTIVE/etc rows
) with check (
  -- even within this policy, the target status a business can set is limited
  -- to what 003's transition trigger allows FROM DRAFT/SUBMITTED, so this
  -- check is redundant-but-explicit defense in depth against the trigger
  -- ever being disabled by mistake.
  status in ('DRAFT', 'SUBMITTED', 'CANCELLED')
);
