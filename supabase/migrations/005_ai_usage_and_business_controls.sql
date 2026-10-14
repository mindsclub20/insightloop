-- InsightLoop AI usage and business-level fair-use controls.
-- Provider API keys are NEVER stored in database tables.
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
  -- A fixed reservation estimate is counted before calling a provider. This is
  -- a fair-use guard, not an exact invoice amount; provider billing alerts remain necessary.
  estimated_cost_microusd bigint not null default 0 check (estimated_cost_microusd >= 0),
  status text not null check (status in ('started', 'succeeded', 'failed', 'rate_limited', 'blocked')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_business_created_idx
  on public.ai_usage_events (business_id, created_at desc);
create index if not exists ai_usage_events_business_purpose_idx
  on public.ai_usage_events (business_id, purpose, created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;

create table if not exists public.business_ai_limits (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  monthly_request_limit integer not null default 300 check (monthly_request_limit between 1 and 100000),
  monthly_budget_microusd bigint not null default 5000000 check (monthly_budget_microusd >= 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.business_ai_limits enable row level security;
revoke all on public.business_ai_limits from anon, authenticated;

-- Atomically reserves one request and a conservative estimated amount. The row
-- lock prevents concurrent requests from racing past the per-business limits.
create or replace function public.reserve_ai_usage(
  p_business_id uuid,
  p_user_id uuid,
  p_provider text,
  p_purpose text,
  p_model text,
  p_reserve_cost_microusd bigint default 25000
)
returns table (allowed boolean, event_id uuid, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  limits_row public.business_ai_limits%rowtype;
  month_start timestamptz := date_trunc('month', now());
  used_requests bigint;
  reserved_cost bigint;
  new_event_id uuid;
begin
  if p_provider not in ('gemini', 'grok')
     or p_purpose not in ('survey_generation', 'ad_generation', 'market_research', 'report_analysis')
     or p_reserve_cost_microusd < 0 or p_reserve_cost_microusd > 1000000 then
    return query select false, null::uuid, 'invalid_request'::text;
    return;
  end if;

  insert into public.business_ai_limits (business_id)
  values (p_business_id)
  on conflict (business_id) do nothing;

  select * into limits_row
  from public.business_ai_limits
  where business_id = p_business_id
  for update;

  if not limits_row.enabled then
    return query select false, null::uuid, 'disabled'::text;
    return;
  end if;

  select count(*), coalesce(sum(estimated_cost_microusd), 0)
    into used_requests, reserved_cost
  from public.ai_usage_events
  where business_id = p_business_id and created_at >= month_start;

  if used_requests >= limits_row.monthly_request_limit then
    return query select false, null::uuid, 'request_limit'::text;
    return;
  end if;

  if reserved_cost + p_reserve_cost_microusd > limits_row.monthly_budget_microusd then
    return query select false, null::uuid, 'budget_limit'::text;
    return;
  end if;

  insert into public.ai_usage_events (
    business_id, user_id, provider, purpose, model,
    estimated_cost_microusd, status
  ) values (
    p_business_id, p_user_id, p_provider, p_purpose, p_model,
    p_reserve_cost_microusd, 'started'
  ) returning id into new_event_id;

  return query select true, new_event_id, 'reserved'::text;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, uuid, text, text, text, bigint) to service_role;
