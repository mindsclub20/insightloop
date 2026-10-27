-- Persist research planner briefs independently of survey publishing.
-- This migration is additive; it does not change existing projects or token workflows.
create table if not exists public.research_briefs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 120),
  brief_data jsonb not null check (jsonb_typeof(brief_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_briefs_business_updated_idx
  on public.research_briefs (business_id, updated_at desc);
alter table public.research_briefs enable row level security;
-- The application accesses this table through a service-role Edge Function
-- that validates the caller's BUSINESS role and business membership.
revoke all on public.research_briefs from anon, authenticated;
