-- 021_role_claim_guard_update.sql
-- Keep role-escalation checks compatible with current Supabase guidance:
-- auth.role() is deprecated; inspect the signed JWT role claim instead.
create or replace function private.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       and private.current_user_role() is distinct from 'SUPER_ADMIN'::public.user_role then
      raise exception 'Profile role changes require SUPER_ADMIN authorization';
    end if;
  end if;
  return new;
end;
$$;
