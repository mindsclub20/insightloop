-- Atomic, ownership-scoped deletion for unpublished business drafts.
-- Called only by the authenticated delete-survey-draft Edge Function using service_role.
create or replace function public.delete_business_draft(
  p_research_project_id uuid,
  p_business_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  if not exists (
    select 1 from public.research_projects
    where id = p_research_project_id
      and business_id = p_business_id
      and status = 'DRAFT'
  ) then
    raise exception 'Draft not found, or it is no longer deletable';
  end if;

  if exists (select 1 from public.business_payments where research_project_id = p_research_project_id)
     or exists (select 1 from public.survey_platform_fees where research_project_id = p_research_project_id) then
    raise exception 'This draft has a financial record and cannot be deleted. Contact support.';
  end if;

  delete from public.research_projects
  where id = p_research_project_id
    and business_id = p_business_id
    and status = 'DRAFT'
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Draft was not deleted. Refresh and try again.';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_business_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_business_draft(uuid, uuid) to service_role;
