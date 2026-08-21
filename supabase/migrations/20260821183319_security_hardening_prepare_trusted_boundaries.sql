-- Prepare trusted server-only boundaries without changing current public behavior.

GRANT EXECUTE ON FUNCTION api.marketplace_match_preview(text, domain.tank_tier, domain.timing_kind, date)
TO drainly_system;

GRANT CREATE ON SCHEMA internal TO drainly_routine_owner;

CREATE OR REPLACE FUNCTION internal.get_proof_verification_context_for_actor(
  p_proof_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_context jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'proofId', jp.id,
    'orderId', jp.order_id,
    'storagePath', jp.storage_path,
    'mimeType', jp.mime_type,
    'sizeBytes', jp.size_bytes,
    'checksumSha256', jp.checksum_sha256,
    'status', jp.status
  )
  INTO v_context
  FROM domain.job_proofs jp
  JOIN domain.order_assignments assignment
    ON assignment.id = jp.assignment_id
  JOIN domain.contractor_users member
    ON member.contractor_company_id = assignment.contractor_company_id
  WHERE jp.id = p_proof_id
    AND jp.status = 'PENDING'
    AND jp.uploaded_by = p_actor_user_id
    AND assignment.order_id = jp.order_id
    AND assignment.released_at IS NULL
    AND member.auth_user_id = p_actor_user_id
    AND member.active;

  IF v_context IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'PROOF_FINALIZE_NOT_AUTHORIZED';
  END IF;

  RETURN v_context;
END
$function$;

ALTER FUNCTION internal.get_proof_verification_context_for_actor(uuid, uuid)
OWNER TO drainly_routine_owner;
REVOKE ALL ON FUNCTION internal.get_proof_verification_context_for_actor(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION internal.get_proof_verification_context_for_actor(uuid, uuid)
TO drainly_system;

CREATE OR REPLACE FUNCTION internal.verify_job_proof_for_actor(
  p_proof_id uuid,
  p_actor_user_id uuid,
  p_succeeded boolean,
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status domain.proof_status;
BEGIN
  SELECT jp.status
  INTO v_status
  FROM domain.job_proofs jp
  JOIN domain.order_assignments assignment
    ON assignment.id = jp.assignment_id
  JOIN domain.contractor_users member
    ON member.contractor_company_id = assignment.contractor_company_id
  WHERE jp.id = p_proof_id
    AND jp.uploaded_by = p_actor_user_id
    AND assignment.order_id = jp.order_id
    AND assignment.released_at IS NULL
    AND member.auth_user_id = p_actor_user_id
    AND member.active
  FOR UPDATE OF jp;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'PROOF_FINALIZE_NOT_AUTHORIZED';
  END IF;

  IF (p_succeeded AND v_status = 'VERIFIED')
     OR (NOT p_succeeded AND v_status = 'REJECTED') THEN
    RETURN;
  END IF;

  UPDATE domain.job_proofs
  SET status = CASE
        WHEN p_succeeded THEN 'VERIFIED'::domain.proof_status
        ELSE 'REJECTED'::domain.proof_status
      END,
      verified_at = CASE WHEN p_succeeded THEN pg_catalog.now() ELSE NULL END
  WHERE id = p_proof_id
    AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'PROOF_NOT_PENDING';
  END IF;

  IF NOT p_succeeded THEN
    INSERT INTO domain.audit_records(
      actor_type, action, resource_type, resource_id, reason, metadata
    )
    VALUES (
      'SYSTEM',
      'JOB_PROOF_REJECTED',
      'job_proof',
      p_proof_id,
      pg_catalog.left(p_failure_reason, 500),
      pg_catalog.jsonb_build_object('finalizedBy', p_actor_user_id)
    );
  END IF;
END
$function$;

ALTER FUNCTION internal.verify_job_proof_for_actor(uuid, uuid, boolean, text)
OWNER TO drainly_routine_owner;
REVOKE ALL ON FUNCTION internal.verify_job_proof_for_actor(uuid, uuid, boolean, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION internal.verify_job_proof_for_actor(uuid, uuid, boolean, text)
TO drainly_system;

REVOKE CREATE ON SCHEMA internal FROM drainly_routine_owner;