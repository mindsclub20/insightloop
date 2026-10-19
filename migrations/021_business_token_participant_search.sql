-- 021_business_token_participant_search.sql
create or replace function public.business_search_token_participants(p_query text default '')
returns table (user_id uuid, full_name text, city text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_query text := left(trim(coalesce(p_query, '')), 80);
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'BUSINESS' and p.status = 'ACTIVE')
     or not exists (select 1 from public.businesses b left join public.business_members bm on bm.business_id = b.id where b.owner_user_id = v_uid or bm.user_id = v_uid)
  then raise exception 'Business access required'; end if;
  return query select p.id, p.full_name, p.city from public.profiles p
    where p.role = 'USER' and p.status = 'ACTIVE'
      and (v_query = '' or coalesce(p.full_name, '') ilike '%' || replace(replace(replace(v_query, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%' escape chr(92))
    order by p.full_name nulls last limit 50;
end; $$;
revoke all on function public.business_search_token_participants(text) from public, anon;
grant execute on function public.business_search_token_participants(text) to authenticated;
