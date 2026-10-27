-- Behavioral checks for migration 026. Run after the isolated fixture and migration.
insert into public.profiles(id, role, status) values
 ('10000000-0000-0000-0000-000000000001','BUSINESS','ACTIVE'),
 ('10000000-0000-0000-0000-000000000002','USER','ACTIVE'),
 ('10000000-0000-0000-0000-000000000003','USER','ACTIVE'),
 ('10000000-0000-0000-0000-000000000004','USER','ACTIVE');

insert into public.businesses(id, owner_user_id)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');

insert into public.research_projects(
 id,business_id,status,token_funding_status,reward_per_response_tokens,token_rewards_paid,sample_size,tokens_reserved
) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ACTIVE','FUNDED',5,0,2,10),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','ACTIVE','FUNDED',5,0,2,0),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','ACTIVE','FUNDED',5,0,2,10);

insert into public.survey_questions(id,research_project_id,is_required) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',true),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',true),
 ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003',true);

-- Valid response, answer, wallet credit, ledger transaction and budget decrement succeed together.
do $$
declare v_result jsonb;
begin
  select public.submit_token_funded_survey_response(
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    15, null, 'VALID', 1,
    '[{"question_id":"40000000-0000-0000-0000-000000000001","text_answer":"Useful"}]'::jsonb,
    '{}'
  ) into v_result;
  if v_result->>'success' <> 'true' or v_result->>'paid' <> 'true' or v_result->>'reward_tokens' <> '5' then
    raise exception 'Valid token submission returned unexpected result: %', v_result;
  end if;
  if (select balance_tokens from public.token_wallets where user_id='10000000-0000-0000-0000-000000000002') <> 5 then
    raise exception 'Participant wallet was not credited by exactly five tokens';
  end if;
  if (select tokens_reserved from public.research_projects where id='30000000-0000-0000-0000-000000000001') <> 5 then
    raise exception 'Reserved token budget was not decremented atomically';
  end if;
  if (select token_rewards_paid from public.research_projects where id='30000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Paid reward count was not incremented';
  end if;
end $$;

-- A duplicate response fails without creating a second answer or reward.
do $$
begin
  begin
    perform public.submit_token_funded_survey_response(
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      15, null, 'VALID', 1,
      '[{"question_id":"40000000-0000-0000-0000-000000000001","text_answer":"Retry"}]'::jsonb,
      '{}'
    );
    raise exception 'Duplicate submission unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
  if (select count(*) from public.survey_responses where research_project_id='30000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Duplicate submission persisted an extra response';
  end if;
  if (select count(*) from public.token_transactions where transaction_type='SURVEY_REWARD') <> 1 then
    raise exception 'Duplicate submission created an extra reward';
  end if;
end $$;

-- Reward-budget failure after response/answer inserts rolls the entire RPC back.
do $$
begin
  begin
    perform public.submit_token_funded_survey_response(
      '30000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003',
      15, null, 'VALID', 1,
      '[{"question_id":"40000000-0000-0000-0000-000000000002","text_answer":"Must roll back"}]'::jsonb,
      '{}'
    );
    raise exception 'Unfunded response unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Unfunded response unexpectedly succeeded' then raise; end if;
  end;
  if exists (select 1 from public.survey_responses where research_project_id='30000000-0000-0000-0000-000000000002') then
    raise exception 'Failed token reward left a response behind';
  end if;
  if exists (select 1 from public.answers where question_id='40000000-0000-0000-0000-000000000002') then
    raise exception 'Failed token reward left an answer behind';
  end if;
end $$;

-- Flagged responses are recorded atomically but do not receive automatic rewards.
do $$
declare v_result jsonb;
begin
  select public.submit_token_funded_survey_response(
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004',
    2, null, 'FLAGGED', 0.7,
    '[{"question_id":"40000000-0000-0000-0000-000000000003","text_answer":"Flagged"}]'::jsonb,
    array['too_fast']
  ) into v_result;
  if v_result->>'status' <> 'FLAGGED' or v_result->>'paid' <> 'false' then
    raise exception 'Flagged response result was unexpected: %', v_result;
  end if;
  if not exists (select 1 from public.response_quality where response_id=(v_result->>'responseId')::uuid) then
    raise exception 'Flagged response has no quality-review record';
  end if;
  if exists (select 1 from public.token_wallets where user_id='10000000-0000-0000-0000-000000000004' and balance_tokens <> 0) then
    raise exception 'Flagged response received an automatic reward';
  end if;
  if (select tokens_reserved from public.research_projects where id='30000000-0000-0000-0000-000000000003') <> 10 then
    raise exception 'Flagged response changed reserved reward budget';
  end if;
end $$;

do $
declare t text;
begin
  foreach t in array array['research_sources','research_findings','research_reports'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relrowsecurity
    ) then
      raise exception 'Research workspace table % is missing or RLS is disabled', t;
    end if;
  end loop;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='research_briefs' and c.relrowsecurity
  ) then
    raise exception 'Research briefs table is missing or RLS is disabled';
  end if;
end $;

select 'atomic token submission integration checks passed' as result;
