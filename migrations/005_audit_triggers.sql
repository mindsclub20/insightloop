-- migrations/005_audit_triggers.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES.
--
-- Guarantees an audit_logs row exists for every security-sensitive state
-- change, independent of whether any route handler remembered to call a
-- logging function. This is the production counterpart to the SQLite
-- triggers added in src/db.js, which use the same design and ARE executed
-- and tested in this repo (see test/audit-triggers.test.js) - the SQLite
-- version is the proof-of-concept for the pattern implemented here.
--
-- Design: a single generic trigger function, parameterized per-table via
-- trigger arguments, so adding audit coverage to a new sensitive column is
-- one CREATE TRIGGER statement, not a new function to review.

create or replace function audit_sensitive_change() returns trigger as $$
declare
  v_column text := TG_ARGV[0];
  v_old jsonb;
  v_new jsonb;
begin
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  if v_old ->> v_column is distinct from v_new ->> v_column then
    insert into audit_logs (id, actor_id, action, table_name, record_id, old_values, new_values)
    values (
      gen_random_uuid(),
      auth.uid(), -- the actual authenticated caller for this request, from Supabase's session - not a client-supplied field
      TG_ARGV[0] || '_CHANGED',
      TG_TABLE_NAME,
      new.id,
      jsonb_build_object(v_column, v_old ->> v_column),
      jsonb_build_object(v_column, v_new ->> v_column)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- profiles.role — the single most security-critical column in the schema.
-- Fires in addition to (not instead of) the block_role_escalation trigger
-- from 002, which prevents the change; this one records it if it's ever
-- attempted by a SUPER_ADMIN through the legitimate path.
drop trigger if exists audit_role_change on profiles;
create trigger audit_role_change
  after update on profiles
  for each row execute function audit_sensitive_change('role');

-- businesses.verification_status
drop trigger if exists audit_business_verification on businesses;
create trigger audit_business_verification
  after update on businesses
  for each row execute function audit_sensitive_change('verification_status');

-- research_projects.status — every lifecycle transition, on top of the
-- transition-legality check from 003 (that trigger can reject an update;
-- this one records whichever updates were actually allowed through).
drop trigger if exists audit_project_status on research_projects;
create trigger audit_project_status
  after update on research_projects
  for each row execute function audit_sensitive_change('status');

-- withdrawals.status — every REQUESTED -> ... transition.
drop trigger if exists audit_withdrawal_status on withdrawals;
create trigger audit_withdrawal_status
  after update on withdrawals
  for each row execute function audit_sensitive_change('status');

-- response_quality.review_decision — human fraud-review outcomes.
drop trigger if exists audit_response_review on response_quality;
create trigger audit_response_review
  after update on response_quality
  for each row execute function audit_sensitive_change('review_decision');

-- users.status (ACTIVE/SUSPENDED) lives on profiles in this schema already
-- covered by... it isn't, separately from role. Add it explicitly:
drop trigger if exists audit_profile_status on profiles;
create trigger audit_profile_status
  after update on profiles
  for each row execute function audit_sensitive_change('status');

-- audit_logs itself is intentionally append-only: no UPDATE/DELETE policy
-- exists for ANY role in 002 (not even admin), and this migration adds a
-- belt-and-suspenders statement-level guard so even a superuser-owned
-- SECURITY DEFINER function couldn't accidentally UPDATE/DELETE it via a
-- typo'd query against the wrong table variable.
create or replace function reject_audit_log_mutation() returns trigger as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted', TG_OP;
end;
$$ language plpgsql;

drop trigger if exists block_audit_log_update on audit_logs;
create trigger block_audit_log_update before update on audit_logs
  for each row execute function reject_audit_log_mutation();

drop trigger if exists block_audit_log_delete on audit_logs;
create trigger block_audit_log_delete before delete on audit_logs
  for each row execute function reject_audit_log_mutation();
