-- migrations/002_rls_policies.sql
--
-- PRODUCTION RLS REFERENCE. The running P0 demo enforces these same rules
-- in the application layer instead (see src/lib/authz.js) because SQLite
-- has no RLS. Before handling any real user data on Supabase, apply this
-- file and then re-verify every rule below against the app-layer checks —
-- they are written to match 1:1, but RLS is the actual enforcement boundary
-- in production and must not be assumed correct just because the app-layer
-- version passed tests.

-- Helper: current role, read from profiles, never from a client-supplied claim.
create or replace function current_user_role() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

alter table profiles enable row level security;
alter table user_interests enable row level security;
alter table businesses enable row level security;
alter table business_members enable row level security;
alter table research_projects enable row level security;
alter table survey_questions enable row level security;
alter table question_options enable row level security;
alter table survey_responses enable row level security;
alter table answers enable row level security;
alter table response_quality enable row level security;
alter table wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table withdrawals enable row level security;
alter table business_payments enable row level security;
alter table notifications enable row level security;
alter table fraud_flags enable row level security;
alter table admin_actions enable row level security;
alter table audit_logs enable row level security;
alter table support_tickets enable row level security;

-- ===== profiles =====
-- Users read/update only their own row. `role` itself is deliberately NOT
-- updatable through this policy - see the trigger below.
create policy "own profile read" on profiles for select using (id = auth.uid());
create policy "own profile update" on profiles for update using (id = auth.uid());
create policy "admin reads all profiles" on profiles for select using (current_user_role() in ('ADMIN','SUPER_ADMIN'));
create policy "admin updates any profile" on profiles for update using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- Hard block on client-side role escalation: even though the UPDATE policy
-- above would otherwise let a user "update their own row", this trigger
-- rejects any change to the role column unless performed by a SUPER_ADMIN
-- through a SECURITY DEFINER function (never directly from client code).
create or replace function prevent_role_self_escalation() returns trigger as $$
begin
  if new.role is distinct from old.role and current_user_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'role changes are not permitted through this path';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger block_role_escalation
  before update on profiles
  for each row execute function prevent_role_self_escalation();

-- ===== user_interests =====
create policy "own interests" on user_interests for all using (user_id = auth.uid());
create policy "admin reads interests" on user_interests for select using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== businesses / business_members =====
create policy "member reads own business" on businesses for select using (
  id in (select business_id from business_members where user_id = auth.uid())
);
create policy "owner updates own business" on businesses for update using (
  id in (select business_id from business_members where user_id = auth.uid() and role = 'OWNER')
);
create policy "admin full access businesses" on businesses for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

create policy "member reads own membership rows" on business_members for select using (user_id = auth.uid());
create policy "admin manages memberships" on business_members for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== research_projects =====
create policy "business reads own projects" on research_projects for select using (
  business_id in (select business_id from business_members where user_id = auth.uid())
);
create policy "business writes own DRAFT projects" on research_projects for update using (
  business_id in (select business_id from business_members where user_id = auth.uid())
  and status = 'DRAFT'
);
create policy "business creates projects for own business" on research_projects for insert with check (
  business_id in (select business_id from business_members where user_id = auth.uid())
);
-- Participants can read only ACTIVE projects (to browse/take surveys) - no
-- visibility into DRAFT/SUBMITTED/etc. projects belonging to businesses
-- they have no relationship to.
create policy "participants read active projects" on research_projects for select using (
  status = 'ACTIVE' and current_user_role() = 'USER'
);
create policy "admin full access projects" on research_projects for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== survey_questions / question_options =====
-- Same visibility rule as the parent project: business owner or admin, or
-- a participant only for ACTIVE studies.
create policy "read questions if project visible" on survey_questions for select using (
  research_project_id in (
    select id from research_projects
    where business_id in (select business_id from business_members where user_id = auth.uid())
       or status = 'ACTIVE'
  )
);
create policy "business manages own DRAFT questions" on survey_questions for all using (
  research_project_id in (
    select id from research_projects rp
    join business_members bm on bm.business_id = rp.business_id
    where bm.user_id = auth.uid() and rp.status = 'DRAFT'
  )
);
create policy "admin full access questions" on survey_questions for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

create policy "read options with question" on question_options for select using (
  question_id in (select id from survey_questions) -- inherits question-level visibility via join in application queries
);
create policy "admin full access options" on question_options for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== survey_responses / answers =====
-- CRITICAL: a business can NEVER read individual respondent identity here.
-- Businesses only ever see aggregated statistics, produced by a
-- SECURITY DEFINER report function that strips user_id - they get no direct
-- SELECT grant on survey_responses/answers at all.
create policy "participant reads own responses" on survey_responses for select using (user_id = auth.uid());
create policy "participant inserts own response" on survey_responses for insert with check (user_id = auth.uid());
create policy "admin full access responses" on survey_responses for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

create policy "participant reads own answers" on answers for select using (
  response_id in (select id from survey_responses where user_id = auth.uid())
);
create policy "participant inserts own answers" on answers for insert with check (
  response_id in (select id from survey_responses where user_id = auth.uid())
);
create policy "admin full access answers" on answers for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

create policy "admin full access response_quality" on response_quality for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== wallets / wallet_transactions =====
-- Read-only for the owning user. NO insert/update grant for USER at all -
-- every balance change happens through SECURITY DEFINER functions
-- (credit-reward, process-withdrawal) running with elevated privileges,
-- exactly mirroring src/lib/ledger.js being the only writer in the demo.
create policy "own wallet read" on wallets for select using (user_id = auth.uid());
create policy "admin full access wallets" on wallets for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

create policy "own transactions read" on wallet_transactions for select using (
  wallet_id in (select id from wallets where user_id = auth.uid())
);
create policy "admin full access transactions" on wallet_transactions for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== withdrawals =====
create policy "own withdrawals read" on withdrawals for select using (user_id = auth.uid());
create policy "own withdrawals insert" on withdrawals for insert with check (user_id = auth.uid());
create policy "admin full access withdrawals" on withdrawals for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== business_payments =====
create policy "business reads own payments" on business_payments for select using (
  business_id in (select business_id from business_members where user_id = auth.uid())
);
create policy "admin full access payments" on business_payments for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));

-- ===== notifications =====
create policy "own notifications" on notifications for all using (user_id = auth.uid());

-- ===== fraud_flags / admin_actions / audit_logs =====
-- Admin/SUPER_ADMIN only. No USER or BUSINESS grant exists on these tables
-- at all - not even a read grant - since they can reveal moderation logic.
create policy "admin only fraud_flags" on fraud_flags for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));
create policy "admin only admin_actions" on admin_actions for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));
create policy "admin only audit_logs select" on audit_logs for select using (current_user_role() in ('ADMIN','SUPER_ADMIN'));
-- audit_logs has no UPDATE/DELETE policy for ANY role, including admin -
-- it is append-only at the RLS layer, insert-only via SECURITY DEFINER
-- triggers on the tables it tracks.

-- ===== support_tickets =====
create policy "own tickets" on support_tickets for select using (user_id = auth.uid());
create policy "own ticket creation" on support_tickets for insert with check (user_id = auth.uid());
create policy "admin full access tickets" on support_tickets for all using (current_user_role() in ('ADMIN','SUPER_ADMIN'));
