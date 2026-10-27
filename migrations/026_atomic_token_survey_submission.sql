-- 026_atomic_token_survey_submission.sql
-- Keep response, answers, reward ledger, participant wallet, and reserved budget
-- in one PostgreSQL transaction. An exception rolls every write back.
create or replace function public.submit_token_funded_survey_response(
  p_research_project_id uuid,
  p_user_id uuid,
  p_duration_seconds integer,
  p_device_fingerprint text,
  p_status text,
  p_quality_score numeric,
  p_answers jsonb,
  p_flag_reasons text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project public.research_projects%rowtype;
  v_response public.survey_responses%rowtype;
  v_reward bigint;
  v_business_user_id uuid;
  v_answer_count integer;
begin
  if p_research_project_id is null or p_user_id is null then
    raise exception 'Survey and participant are required';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 then
    raise exception 'A valid response duration is required';
  end if;
  if p_status is null or p_status not in ('VALID', 'FLAGGED') then
    raise exception 'Invalid response quality status';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception 'Answers are required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.role = 'USER' and p.status = 'ACTIVE'
  ) then
    raise exception 'Active participant account required';
  end if;

  -- Lock the project first so concurrent submissions cannot overspend its budget.
  select rp.* into v_project
  from public.research_projects rp
  where rp.id = p_research_project_id
  for update;
  if not found then raise exception 'Survey not found'; end if;
  if v_project.status <> 'ACTIVE' or v_project.token_funding_status <> 'FUNDED' then
    raise exception 'Survey token funding is not active';
  end if;

  select count(*) into v_answer_count
  from jsonb_array_elements(p_answers) as submitted(value)
  join public.survey_questions q
    on q.id = (submitted.value->>'question_id')::uuid
   and q.research_project_id = p_research_project_id;
  if v_answer_count <> jsonb_array_length(p_answers) then
    raise exception 'One or more answers do not belong to this survey';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_answers) as submitted(value)
    group by submitted.value->>'question_id' having count(*) > 1
  ) then
    raise exception 'Only one answer per question is allowed';
  end if;

  if exists (
    select 1
    from public.survey_questions q
    where q.research_project_id = p_research_project_id
      and q.is_required
      and not exists (
        select 1 from jsonb_array_elements(p_answers) as submitted(value)
        where submitted.value->>'question_id' = q.id::text
          and (
            (jsonb_typeof(submitted.value->'selected_option_ids') = 'array' and jsonb_array_length(submitted.value->'selected_option_ids') > 0)
            or nullif(trim(submitted.value->>'text_answer'), '') is not null
            or nullif(submitted.value->>'rating_value', '') is not null
          )
      )
  ) then
    raise exception 'A required question is unanswered';
  end if;

  insert into public.survey_responses (
    research_project_id, user_id, completed_at, duration_seconds,
    device_fingerprint, status, quality_score
  ) values (
    p_research_project_id, p_user_id, now(), p_duration_seconds,
    p_device_fingerprint, p_status::public.response_status, p_quality_score
  ) returning * into v_response;

  insert into public.answers (
    response_id, question_id, selected_option_ids, text_answer, rating_value
  )
  select
    v_response.id,
    (submitted.value->>'question_id')::uuid,
    case when submitted.value ? 'selected_option_ids' then submitted.value->'selected_option_ids' else null end,
    nullif(submitted.value->>'text_answer', ''),
    nullif(submitted.value->>'rating_value', '')::integer
  from jsonb_array_elements(p_answers) as submitted(value);

  if p_status = 'FLAGGED' then
    insert into public.response_quality(response_id, flag_reasons)
    values (v_response.id, to_jsonb(coalesce(p_flag_reasons, '{}'::text[])));
    if coalesce(array_length(p_flag_reasons, 1), 0) > 0 then
      insert into public.fraud_flags(entity_type, entity_id, reason, severity)
      values ('RESPONSE', v_response.id, array_to_string(p_flag_reasons, '; '), 'MEDIUM');
    end if;
    return jsonb_build_object(
      'success', true, 'responseId', v_response.id,
      'status', p_status, 'paid', false, 'reward_tokens', 0
    );
  end if;

  v_reward := v_project.reward_per_response_tokens;
  if v_reward is null or v_reward < 5 then raise exception 'Invalid configured token reward'; end if;
  if v_project.token_rewards_paid >= v_project.sample_size
     or v_project.tokens_reserved < v_reward then
    raise exception 'Survey reward budget is exhausted';
  end if;

  select b.owner_user_id into v_business_user_id
  from public.businesses b where b.id = v_project.business_id;
  if v_business_user_id is null then raise exception 'Business owner not found'; end if;

  insert into public.token_wallets(user_id, balance_tokens)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.token_wallets
  set balance_tokens = balance_tokens + v_reward, updated_at = now()
  where user_id = p_user_id;

  insert into public.token_transactions (
    sender_user_id, recipient_user_id, amount_tokens,
    transaction_type, idempotency_key, note
  ) values (
    v_business_user_id, p_user_id, v_reward, 'SURVEY_REWARD',
    'survey-reward:' || v_response.id::text,
    'Reward for valid response to survey ' || v_project.id::text
  );

  update public.research_projects
  set tokens_reserved = tokens_reserved - v_reward,
      token_rewards_paid = token_rewards_paid + 1,
      token_funding_status = case when tokens_reserved - v_reward = 0 then 'EXHAUSTED' else token_funding_status end,
      updated_at = now()
  where id = v_project.id;

  return jsonb_build_object(
    'success', true, 'responseId', v_response.id,
    'status', p_status, 'paid', true, 'reward_tokens', v_reward
  );
end;
$function$;

revoke all on function public.submit_token_funded_survey_response(uuid, uuid, integer, text, text, numeric, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.submit_token_funded_survey_response(uuid, uuid, integer, text, text, numeric, jsonb, text[]) to service_role;
