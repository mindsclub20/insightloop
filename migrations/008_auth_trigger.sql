-- migrations/008_auth_trigger.sql
--
-- WRITTEN, NOT EXECUTED AGAINST REAL POSTGRES/AUTH.
--
-- This is the actual replacement for src/routes/auth.js's registerParticipant
-- / registerBusiness in production: Supabase Auth's signUp() creates the
-- auth.users row; THIS trigger creates the matching profiles row
-- immediately after, reading whatever the client passed in
-- raw_user_meta_data (full_name, city, date_of_birth, role_requested) -
-- critically, the trigger decides the actual `role` written, and a client
-- claiming role_requested = 'ADMIN' is simply ignored, not honored. This is
-- the server-side backstop for the registration flow shown in
-- mobile/app/(auth)/register.tsx and public/js/supabase-integration-example.js.

create or replace function handle_new_user() returns trigger as $$
declare
  v_role user_role := 'USER'; -- the only role signup can ever produce; BUSINESS is set explicitly below only for the business-signup path, ADMIN/SUPER_ADMIN are NEVER settable from this trigger
  v_dob date;
  v_age numeric;
begin
  -- Age gate enforced HERE, server-side - the client-side check in
  -- mobile/app/(auth)/register.tsx and any equivalent web form is UX only
  -- and bypassable by a modified client; this is the real boundary.
  if new.raw_user_meta_data ? 'date_of_birth' then
    v_dob := (new.raw_user_meta_data ->> 'date_of_birth')::date;
    v_age := extract(epoch from (now() - v_dob::timestamptz)) / (365.25 * 24 * 60 * 60);
    if v_age < 18 then
      raise exception 'InsightLoop is currently restricted to participants aged 18 and over';
    end if;
  elsif coalesce(new.raw_user_meta_data ->> 'account_type', 'participant') = 'participant' then
    -- Participant signup with no date_of_birth at all is rejected outright
    -- rather than silently allowed through - "missing" must not be
    -- treated as "adult".
    raise exception 'date_of_birth is required to register as a participant';
  end if;

  if new.raw_user_meta_data ->> 'account_type' = 'business' then
    v_role := 'BUSINESS';
  end if;

  insert into profiles (id, role, full_name, city, age_range)
  values (
    new.id,
    v_role,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'city',
    new.raw_user_meta_data ->> 'age_range'
  );

  insert into wallets (id, user_id) values (gen_random_uuid(), new.id);

  -- Business accounts also need a businesses row + business_members row,
  -- but that requires a legal_name/category the auth signup form may not
  -- collect in the same step as email/password - left as a follow-up
  -- "complete your business profile" step calling a dedicated
  -- create-business Edge Function post-signup, rather than cramming
  -- business-specific fields into every signup's metadata. Not implemented
  -- as part of this trigger; flagged rather than half-built.

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
