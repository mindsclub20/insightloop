-- Minimal isolated PostgreSQL fixture for migration 026.
-- Runs only inside the ephemeral GitHub Actions PostgreSQL service.
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create type public.response_status as enum ('PENDING','VALID','FLAGGED','REJECTED');

create table public.profiles (
  id uuid primary key,
  role text not null,
  status text not null
);
create table public.businesses (
  id uuid primary key,
  owner_user_id uuid not null references public.profiles(id)
);
create table public.research_projects (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  status text not null,
  token_funding_status text not null,
  reward_per_response_tokens bigint not null,
  token_rewards_paid bigint not null default 0,
  sample_size integer not null,
  tokens_reserved bigint not null,
  updated_at timestamptz not null default now()
);
create table public.survey_questions (
  id uuid primary key,
  research_project_id uuid not null references public.research_projects(id),
  is_required boolean not null default true
);
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id),
  user_id uuid not null references public.profiles(id),
  completed_at timestamptz,
  duration_seconds integer,
  device_fingerprint text,
  status public.response_status not null,
  quality_score numeric,
  unique (research_project_id, user_id)
);
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id),
  selected_option_ids jsonb,
  text_answer text,
  rating_value integer
);
create table public.response_quality (
  response_id uuid primary key references public.survey_responses(id) on delete cascade,
  flag_reasons jsonb not null
);
create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  reason text not null,
  severity text not null
);
create table public.token_wallets (
  user_id uuid primary key references public.profiles(id),
  balance_tokens bigint not null default 0 check (balance_tokens >= 0),
  updated_at timestamptz not null default now()
);
create table public.token_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid references public.profiles(id),
  recipient_user_id uuid not null references public.profiles(id),
  amount_tokens bigint not null check (amount_tokens > 0),
  transaction_type text not null check (transaction_type in ('ADMIN_GRANT','BUSINESS_TRANSFER','SURVEY_FUNDING','PLATFORM_FEE','SURVEY_REWARD','SURVEY_REFUND')),
  idempotency_key text not null unique,
  note text
);
