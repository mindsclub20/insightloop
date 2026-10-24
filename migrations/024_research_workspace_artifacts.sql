-- Additive research-workspace persistence for Anvesh.
-- Intentionally not applied to production by this commit.
-- Existing projects, surveys, responses, token ledgers, and report computation remain unchanged.

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 240),
  source_type text not null default 'other'
    check (source_type in ('web', 'document', 'interview', 'survey', 'dataset', 'other')),
  source_url text,
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is null or length(source_url) <= 2048)
);

create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 240),
  detail text not null check (length(trim(detail)) between 1 and 12000),
  evidence text not null default '',
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  status text not null default 'draft' check (status in ('draft', 'verified', 'rejected')),
  source_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_reports (
  id uuid primary key default gen_random_uuid(),
  research_project_id uuid not null references public.research_projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 240),
  report_data jsonb not null,
  version integer not null check (version > 0),
  report_status text not null default 'draft' check (report_status in ('draft', 'reviewed', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (research_project_id, version)
);

create index if not exists research_sources_project_created_idx
  on public.research_sources (research_project_id, created_at desc);
create index if not exists research_findings_project_created_idx
  on public.research_findings (research_project_id, created_at desc);
create index if not exists research_reports_project_version_idx
  on public.research_reports (research_project_id, version desc);

alter table public.research_sources enable row level security;
alter table public.research_findings enable row level security;
alter table public.research_reports enable row level security;

drop policy if exists "Business members manage research sources" on public.research_sources;
create policy "Business members manage research sources"
on public.research_sources for all to authenticated
using (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_sources.research_project_id and bm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_sources.research_project_id and bm.user_id = auth.uid()
  ) and created_by = auth.uid()
);

drop policy if exists "Business members manage research findings" on public.research_findings;
create policy "Business members manage research findings"
on public.research_findings for all to authenticated
using (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_findings.research_project_id and bm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_findings.research_project_id and bm.user_id = auth.uid()
  ) and created_by = auth.uid()
);

drop policy if exists "Business members manage research reports" on public.research_reports;
create policy "Business members manage research reports"
on public.research_reports for all to authenticated
using (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_reports.research_project_id and bm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.research_projects rp
    join public.business_members bm on bm.business_id = rp.business_id
    where rp.id = research_reports.research_project_id and bm.user_id = auth.uid()
  ) and created_by = auth.uid()
);

-- RLS is necessary but does not grant SQL privileges by itself.
grant select, insert, update, delete on public.research_sources to authenticated;
grant select, insert, update, delete on public.research_findings to authenticated;
grant select, insert, update, delete on public.research_reports to authenticated;
