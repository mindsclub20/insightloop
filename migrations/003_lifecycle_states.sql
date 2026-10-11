-- migrations/003_lifecycle_states.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES. This is reviewed SQL, not a
-- verified migration — see README "What has been written but not executed"
-- for what that distinction means here.
--
-- Adds PAUSED, CANCELLED, REPORT_READY to the study lifecycle and installs a
-- trigger that rejects any UPDATE to research_projects.status that isn't a
-- legal transition — so "a business cannot activate its own study without
-- approval" (and every other lifecycle rule) is enforced at the database
-- level, not just by whichever route happens to call the right function.
--
-- Does NOT modify 001_postgres_schema.sql. Postgres enum types cannot have
-- values removed or reordered without recreating the type, but new values
-- can be added with ALTER TYPE ... ADD VALUE, which is additive and safe.

-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction block as
-- code that uses the new value, but each statement below is safe run in
-- sequence via the Supabase CLI / psql.
alter type project_status add value if not exists 'PAUSED';
alter type project_status add value if not exists 'CANCELLED';
alter type project_status add value if not exists 'REPORT_READY';

-- The full, explicit state machine. Anything not listed here is illegal.
-- Kept as a plain table (not hardcoded in the trigger function body) so the
-- allowed graph can be inspected/audited with a simple SELECT, and updated
-- without touching trigger logic.
create table if not exists project_status_transitions (
  from_status project_status not null,
  to_status project_status not null,
  primary key (from_status, to_status)
);

insert into project_status_transitions (from_status, to_status) values
  ('DRAFT', 'SUBMITTED'),
  ('DRAFT', 'CANCELLED'),
  ('SUBMITTED', 'ADMIN_REVIEW'),
  ('SUBMITTED', 'APPROVED'),
  ('SUBMITTED', 'REJECTED'),
  ('SUBMITTED', 'CANCELLED'),
  ('ADMIN_REVIEW', 'APPROVED'),
  ('ADMIN_REVIEW', 'REJECTED'),
  ('ADMIN_REVIEW', 'CANCELLED'),
  ('APPROVED', 'ACTIVE'),
  ('ACTIVE', 'PAUSED'),
  ('ACTIVE', 'COMPLETED'),
  ('ACTIVE', 'CANCELLED'),
  ('PAUSED', 'ACTIVE'),
  ('PAUSED', 'CANCELLED'),
  ('COMPLETED', 'REPORT_READY'),
  ('REPORT_READY', 'ARCHIVED'),
  ('COMPLETED', 'ARCHIVED')
on conflict do nothing;

create or replace function enforce_project_status_transition() returns trigger as $$
begin
  if new.status is distinct from old.status then
    if not exists (
      select 1 from project_status_transitions
      where from_status = old.status and to_status = new.status
    ) then
      raise exception 'Illegal research_projects status transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists guard_project_status_transition on research_projects;
create trigger guard_project_status_transition
  before update on research_projects
  for each row execute function enforce_project_status_transition();

-- NOTE: this trigger enforces *which* transitions are legal (the shape of
-- the graph). It intentionally does NOT enforce *who* may perform a given
-- transition (e.g. "only an admin may move SUBMITTED -> APPROVED", "a
-- business may only move its own DRAFT -> CANCELLED") — that half of the
-- rule belongs in RLS policies (see 004_rls_hardening.sql), because RLS
-- can see auth.uid()/role and this generic trigger deliberately does not
-- need to, keeping the two concerns separable and each independently
-- testable.
