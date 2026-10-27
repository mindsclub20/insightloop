-- Minimal isolated PostgreSQL fixture aligned to the live Supabase column types and constraints.
-- Executed only in the ephemeral GitHub Actions PostgreSQL service.
create extension if not exists pgcrypto;
create schema auth;
create function auth.uid() returns uuid language sql stable as $ select null::uuid $;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create type public.user_role as enum ('USER','BUSINESS','ADMIN','SUPER_ADMIN');
create type public.account_status as enum ('ACTIVE','SUSPENDED');
create type public.project_status as enum ('DRAFT','SUBMITTED','ADMIN_REVIEW','APPROVED','ACTIVE','COMPLETED','ARCHIVED','REJECTED');
create type public.response_status as enum ('PENDING','VALID','FLAGGED','REJECTED');

create table public.profiles (
  id uuid primary key,
  role public.user_role not null default 'USER',
  status public.account_status not null default 'ACTIVE'
);
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id)
);
create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (business_id, user_id)
);
create table public.research_projects (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status public.project_status not null default 'DRAFT',
  token_funding_status text not null default 'UNFUNDED'
    check (token_funding_status in ('UNFUNDED','FUNDED','EXHAUSTED','REFUNDED')),
  reward_per_response_tokens bigint,
  token_rewards_paid bigint not null default 0,
  sample_size integer not null,
  tokens_reserved bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.survey_questions (
  id uuid primary key,
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  question_text text not null default 'Test question',
  is_required boolean not null default true
);
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz,
  duration_seconds integer,
  device_fingerprint text,
  status public.response_status not null default 'PENDING',
  quality_score numeric,
  created_at timestamptz not null default now(),
  unique (research_project_id, user_id)
);
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  selected_option_ids jsonb,
  text_answer text,
  rating_value integer
);
create table public.response_quality (
  response_id uuid primary key references public.survey_responses(id) on delete cascade,
  flag_reasons jsonb not null default '[]'::jsonb
);
create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  reason text not null,
  severity text not null default 'MEDIUM',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.token_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_tokens bigint not null default 0 check (balance_tokens >= 0),
  updated_at timestamptz not null default now()
);
create table public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid references public.profiles(id) on delete set null,
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  amount_tokens bigint not null check (amount_tokens > 0),
  transaction_type text not null check (transaction_type in ('ADMIN_GRANT','BUSINESS_TRANSFER','SURVEY_FUNDING','PLATFORM_FEE','SURVEY_REWARD','SURVEY_REFUND')),
  idempotency_key text not null unique,
  note text,
  created_at timestamptz not null default now()
);
