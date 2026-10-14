-- InsightLoop AI usage and business-level fair-use controls.
-- Apply to the Supabase Survey project only after reviewing in a preview project.
-- API credentials are NEVER stored in this table.
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gemini', 'grok')),
  purpose text not null check (purpose in ('survey_generation', 'ad_generation', 'market_research', 'report_analysis')),
  model text not null,
  request_id text,
  input_chars integer not null default 0 check (input_chars >= 0),
  output_chars integer not null default 0 check (output_chars >= 0),
  estimated_cost_microusd bigint not null default 0 check (estimated_cost_microusd >= 0),
  status text not null check (status in ('succeeded', 'failed', 'rate_limited', 'blocked')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_business_created_idx
  on public.ai_usage_events (business_id, created_at desc);
create index if not exists ai_usage_events_business_purpose_idx
  on public.ai_usage_events (business_id, purpose, created_at desc);

alter table public.ai_usage_events enable row level security;
-- Businesses may inspect aggregate usage through a trusted server function only.
-- No direct client SELECT/INSERT/UPDATE/DELETE policy is intentionally created.
revoke all on public.ai_usage_events from anon, authenticated;

create table if not exists public.business_ai_limits (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  monthly_request_limit integer not null default 300 check (monthly_request_limit between 1 and 100000),
  monthly_budget_microusd bigint not null default 5000000 check (monthly_budget_microusd >= 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.business_ai_limits enable row level security;
-- Changes and reads are server-controlled so clients cannot raise their own limits.
revoke all on public.business_ai_limits from anon, authenticated;
