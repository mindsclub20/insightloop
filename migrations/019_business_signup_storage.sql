-- Supabase Auth: create persistent business and membership records during signup.
-- This trigger runs after the existing profile/wallet auth trigger. The operation
-- is idempotent so retries cannot create duplicate business memberships.
create or replace function public.handle_new_business_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_legal_name text;
begin
  if coalesce(new.raw_user_meta_data ->> 'account_type', 'participant') <> 'business' then
    return new;
  end if;

  v_legal_name := nullif(btrim(new.raw_user_meta_data ->> 'legal_name'), '');
  if v_legal_name is null then
    raise exception 'Business legal name is required';
  end if;

  insert into public.profiles (id, role, full_name, city, status)
  values (
    new.id,
    'BUSINESS'::public.user_role,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    'ACTIVE'::public.account_status
  )
  on conflict (id) do update set
    role = 'BUSINESS'::public.user_role,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    city = coalesce(excluded.city, public.profiles.city);

  insert into public.wallets (id, user_id)
  values (gen_random_uuid(), new.id)
  on conflict (user_id) do nothing;

  select id into v_business_id
  from public.businesses
  where owner_user_id = new.id
  limit 1;

  if v_business_id is null then
    insert into public.businesses (owner_user_id, legal_name, city, category, gstin, verification_status)
    values (
      new.id,
      v_legal_name,
      nullif(new.raw_user_meta_data ->> 'city', ''),
      nullif(new.raw_user_meta_data ->> 'category', ''),
      nullif(new.raw_user_meta_data ->> 'gstin', ''),
      'PENDING'::public.verification_status
    )
    returning id into v_business_id;
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, new.id, 'OWNER')
  on conflict (business_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists zz_handle_new_business_signup on auth.users;
create trigger zz_handle_new_business_signup
after insert on auth.users
for each row
when ((new.raw_user_meta_data ->> 'account_type') = 'business')
execute function public.handle_new_business_signup();

revoke all on function public.handle_new_business_signup() from public, anon, authenticated;
