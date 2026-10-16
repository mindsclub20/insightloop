-- 020_live_security_hardening.sql
-- Targeted hardening for the already-initialized Supabase project.
-- Additive / access-control only: no rows or tables are deleted.
-- The trusted Edge Functions use the server-side service role for writes.

-- 1. Stop users from promoting themselves by updating profiles.role.
-- Only a SUPER_ADMIN acting through an authenticated session, or a trusted
-- service-role backend, may change the role column.
create or replace function private.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(auth.role(), '') <> 'service_role'
       and private.current_user_role() is distinct from 'SUPER_ADMIN'::public.user_role then
      raise exception 'Profile role changes require SUPER_ADMIN authorization';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_profile_role_escalation() from public, anon, authenticated;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation
before update of role on public.profiles
for each row
execute function private.prevent_profile_role_escalation();

-- Record any legitimate role change. Failed escalation attempts are rejected
-- by the BEFORE trigger and cannot create an audit row for a change that did
-- not happen.
create or replace function private.audit_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    insert into public.audit_logs
      (actor_id, action, table_name, record_id, old_values, new_values)
    values
      (auth.uid(), 'ROLE_CHANGED', 'profiles', new.id,
       jsonb_build_object('role', old.role),
       jsonb_build_object('role', new.role));
  end if;
  return new;
end;
$$;

revoke all on function private.audit_profile_role_change() from public, anon, authenticated;

drop trigger if exists profiles_audit_role_change on public.profiles;
create trigger profiles_audit_role_change
after update of role on public.profiles
for each row
execute function private.audit_profile_role_change();

-- 2. Survey responses and answers are created/processed by the trusted
-- submit-survey-response Edge Function, which re-checks eligibility and
-- response quality. Direct client writes would bypass those checks and could
-- let a participant self-set a response status or edit a submitted answer.
revoke insert, update, delete on public.survey_responses from public, anon, authenticated;
revoke insert, update, delete on public.answers from public, anon, authenticated;

drop policy if exists responses_insert_self on public.survey_responses;
drop policy if exists survey_responses_self_insert on public.survey_responses;
drop policy if exists responses_update_self_admin on public.survey_responses;
drop policy if exists responses_delete_admin on public.survey_responses;
drop policy if exists answers_insert_owner on public.answers;
drop policy if exists answers_self_insert on public.answers;
drop policy if exists answers_update_owner_admin on public.answers;
drop policy if exists answers_delete_admin on public.answers;

-- 3. Wallet and withdrawal records are ledger-controlled. Do not allow
-- browser clients to write balances or transaction states directly.
revoke insert, update, delete on public.wallets from public, anon, authenticated;
revoke insert, update, delete on public.wallet_transactions from public, anon, authenticated;
revoke insert, update, delete on public.withdrawals from public, anon, authenticated;

drop policy if exists wallets_admin_manage on public.wallets;
drop policy if exists wallet_transactions_admin_manage on public.wallet_transactions;
drop policy if exists withdrawals_insert_owner on public.withdrawals;
drop policy if exists withdrawals_admin_update on public.withdrawals;
drop policy if exists withdrawals_admin_delete on public.withdrawals;
