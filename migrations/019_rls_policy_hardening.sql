-- 009_security_policy_hardening.sql
-- Follow-up hardening for the Supabase project after migrations 001-008.
-- All public tables remain protected by RLS; helper functions live in a
-- non-exposed schema so they cannot be called through the public REST API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = public, private, pg_temp
as $$ select p.role from public.profiles p where p.id = auth.uid() limit 1 $$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = public, private, pg_temp
as $$ select coalesce(private.current_user_role() in ('ADMIN','SUPER_ADMIN'), false) $$;

create or replace function private.is_business_member(target_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private, pg_temp
as $$ select exists (select 1 from public.business_members bm where bm.business_id = target_business_id and bm.user_id = auth.uid()) $$;

create or replace function private.is_business_owner(target_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public, private, pg_temp
as $$ select exists (select 1 from public.business_members bm where bm.business_id = target_business_id and bm.user_id = auth.uid() and bm.role = 'OWNER') $$;

revoke all on function private.current_user_role() from public, anon;
grant execute on function private.current_user_role() to authenticated;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;
revoke all on function private.is_business_member(uuid) from public, anon;
grant execute on function private.is_business_member(uuid) to authenticated;
revoke all on function private.is_business_owner(uuid) from public, anon;
grant execute on function private.is_business_owner(uuid) to authenticated;

-- Prevent role escalation by granting only profile fields users may edit.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, age_range, gender, city, area, occupation_category)
  on public.profiles to authenticated;

-- Verify/enable RLS on every exposed application table.
alter table public.profiles enable row level security;
alter table public.user_interests enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.research_projects enable row level security;
alter table public.survey_questions enable row level security;
alter table public.question_options enable row level security;
alter table public.survey_responses enable row level security;
alter table public.answers enable row level security;
alter table public.response_quality enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.business_payments enable row level security;
alter table public.notifications enable row level security;
alter table public.fraud_flags enable row level security;
alter table public.admin_actions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.support_tickets enable row level security;

-- Audit records are read-only to signed-in administrators; never client-writable.
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
