-- migrations/001_postgres_schema.sql
--
-- PRODUCTION SCHEMA REFERENCE for Supabase/Postgres.
-- The running P0 demo in this repo uses SQLite (src/db.js) so it works with
-- zero external dependencies. This file is the real target schema for an
-- actual Supabase deployment and should be applied via the Supabase CLI
-- (`supabase migration up` / `supabase db push`) when you move off the demo
-- database. Column set mirrors src/db.js exactly; types are upgraded to
-- native Postgres types (uuid, timestamptz, jsonb, numeric for money if you
-- prefer, though this schema keeps *_paise integers to avoid float rounding
-- issues, same as the SQLite version).

create extension if not exists "pgcrypto";

create type user_role as enum ('USER','BUSINESS','ADMIN','SUPER_ADMIN');
create type account_status as enum ('ACTIVE','SUSPENDED');
create type verification_status as enum ('PENDING','VERIFIED','REJECTED');
create type project_status as enum ('DRAFT','SUBMITTED','ADMIN_REVIEW','APPROVED','ACTIVE','COMPLETED','ARCHIVED','REJECTED');
create type question_type as enum ('single_choice','multi_choice','yes_no','rating_5','rating_10','short_text','long_text');
create type response_status as enum ('PENDING','VALID','FLAGGED','REJECTED');
create type tx_type as enum ('SURVEY_REWARD','WITHDRAWAL','ADJUSTMENT','WITHDRAWAL_REVERSAL');
create type tx_status as enum ('PENDING','CONFIRMED','PROCESSING','PAID','FAILED');
create type withdrawal_status as enum ('REQUESTED','PROCESSING','PAID','FAILED','REJECTED');
create type payment_status as enum ('INITIATED','MANUAL_PENDING','SUCCESS','FAILED','REFUNDED');

-- profiles extends Supabase auth.users (id matches auth.uid())
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'USER',
  full_name text,
  phone text unique,
  age_range text,
  gender text,
  city text,
  area text,
  occupation_category text,
  status account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  tag text not null
);
create index on user_interests(user_id);
create index on user_interests(tag);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles(id) on delete cascade,
  legal_name text not null,
  gstin text,
  verification_status verification_status not null default 'PENDING',
  city text,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on businesses(owner_user_id);

create table business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'OWNER' check (role in ('OWNER','EDITOR')),
  unique(business_id, user_id)
);
create index on business_members(user_id);

create table research_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null,
  template_type text not null,
  objective text,
  target_city text not null,
  target_min_age int,
  target_max_age int,
  target_gender text,
  target_tags jsonb not null default '[]',
  sample_size int not null,
  budget_paise bigint not null,
  reward_per_response_paise bigint not null,
  deadline timestamptz,
  status project_status not null default 'DRAFT',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on research_projects(status, target_city);
create index on research_projects(business_id);

create table survey_questions (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references research_projects(id) on delete cascade,
  order_index int not null,
  question_text text not null,
  question_type question_type not null,
  is_required boolean not null default true
);
create index on survey_questions(research_project_id);

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references survey_questions(id) on delete cascade,
  option_text text not null,
  order_index int not null
);
create index on question_options(question_id);

create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references research_projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int,
  status response_status not null default 'PENDING',
  quality_score numeric,
  device_fingerprint text,
  ip_address inet,
  created_at timestamptz not null default now(),
  unique(research_project_id, user_id)
);
create index on survey_responses(research_project_id, status);
create index on survey_responses(device_fingerprint);
create index on survey_responses(user_id);

create table answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references survey_responses(id) on delete cascade,
  question_id uuid not null references survey_questions(id) on delete cascade,
  selected_option_ids jsonb,
  text_answer text,
  rating_value int
);
create index on answers(response_id);
create index on answers(question_id);

create table response_quality (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null unique references survey_responses(id) on delete cascade,
  flag_reasons jsonb not null default '[]',
  reviewed_by uuid references profiles(id),
  review_decision text check (review_decision in ('VALID','REJECTED')),
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  balance_paise bigint not null default 0,
  pending_paise bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id) on delete cascade,
  type tx_type not null,
  amount_paise bigint not null,
  status tx_status not null default 'PENDING',
  reference_id uuid,
  idempotency_key text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on wallet_transactions(wallet_id);
create index on wallet_transactions(reference_id);

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount_paise bigint not null,
  upi_id text not null,
  status withdrawal_status not null default 'REQUESTED',
  ledger_transaction_id uuid references wallet_transactions(id),
  processed_by uuid references profiles(id),
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on withdrawals(user_id);
create index on withdrawals(status);

create table business_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  research_project_id uuid references research_projects(id),
  amount_paise bigint not null,
  gateway_reference text unique,
  status payment_status not null default 'MANUAL_PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on business_payments(business_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id, read_at);

create table fraud_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('USER','RESPONSE','BUSINESS')),
  entity_id uuid not null,
  reason text not null,
  severity text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index on fraud_flags(entity_type, entity_id);
create index on fraud_flags(resolved);

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  action_type text not null,
  target_type text not null,
  target_id uuid not null,
  notes text,
  created_at timestamptz not null default now()
);
create index on admin_actions(admin_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs(table_name, record_id);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  business_id uuid references businesses(id),
  subject text not null,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','CLOSED')),
  assigned_admin uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- See 002_rls_policies.sql for Row Level Security enforcement on every
-- table above (must be applied before any real user data is stored).
