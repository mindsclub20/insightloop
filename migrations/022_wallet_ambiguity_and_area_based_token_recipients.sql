-- 022_wallet_ambiguity_and_area_based_token_recipients.sql
-- Fix wallet output-column ambiguity and remove participant name search from business access.

CREATE OR REPLACE FUNCTION public.get_my_token_wallet()
RETURNS TABLE(user_id uuid, balance_tokens bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.token_wallets AS wallet (user_id)
  VALUES (v_uid)
  ON CONFLICT ON CONSTRAINT token_wallets_pkey DO NOTHING;

  RETURN QUERY
    SELECT wallet.user_id, wallet.balance_tokens
    FROM public.token_wallets AS wallet
    WHERE wallet.user_id = v_uid;
END;
$function$;

DROP FUNCTION IF EXISTS public.business_search_token_participants(text);

CREATE OR REPLACE FUNCTION public.business_list_participant_areas()
RETURNS TABLE(area_name text, participant_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.role = 'BUSINESS' AND p.status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.businesses b
    LEFT JOIN public.business_members bm ON bm.business_id = b.id
    WHERE b.owner_user_id = v_uid OR bm.user_id = v_uid
  ) THEN RAISE EXCEPTION 'Business access required'; END IF;

  RETURN QUERY
  SELECT trim(p.city)::text, count(*)::bigint
  FROM public.profiles p
  WHERE p.role = 'USER' AND p.status = 'ACTIVE'
    AND nullif(trim(p.city), '') IS NOT NULL
  GROUP BY trim(p.city)
  ORDER BY trim(p.city);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_list_area_participants(p_area text)
RETURNS TABLE(user_id uuid, participant_label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.role = 'BUSINESS' AND p.status = 'ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.businesses b
    LEFT JOIN public.business_members bm ON bm.business_id = b.id
    WHERE b.owner_user_id = v_uid OR bm.user_id = v_uid
  ) THEN RAISE EXCEPTION 'Business access required'; END IF;

  IF nullif(trim(p_area), '') IS NULL THEN
    RAISE EXCEPTION 'Select an area';
  END IF;

  RETURN QUERY
  SELECT ranked.id, ('Participant ' || ranked.position::text)::text
  FROM (
    SELECT p.id, row_number() OVER (ORDER BY p.id) AS position
    FROM public.profiles p
    WHERE p.role = 'USER' AND p.status = 'ACTIVE'
      AND trim(p.city) = trim(p_area)
  ) ranked
  ORDER BY ranked.position;
END;
$function$;

REVOKE ALL ON FUNCTION public.business_list_participant_areas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.business_list_area_participants(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_list_participant_areas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_list_area_participants(text) TO authenticated;
