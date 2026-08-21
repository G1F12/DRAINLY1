-- Drainly pre-launch security hardening: repair tenant-scoped RLS predicates
-- and make the operations overview explicitly admin-only.

DROP POLICY IF EXISTS events_actor_select ON domain.order_events;
CREATE POLICY events_actor_select
ON domain.order_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM domain.orders owned_order
    JOIN domain.customers customer ON customer.id = owned_order.customer_id
    WHERE owned_order.id = order_events.order_id
      AND customer.auth_user_id = identity.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM domain.order_assignments assignment
    JOIN domain.contractor_users member
      ON member.contractor_company_id = assignment.contractor_company_id
    WHERE assignment.order_id = order_events.order_id
      AND assignment.released_at IS NULL
      AND member.auth_user_id = identity.uid()
      AND member.active
  )
  OR EXISTS (
    SELECT 1
    FROM domain.platform_admins admin_member
    WHERE admin_member.auth_user_id = identity.uid()
      AND admin_member.active
  )
);

DROP POLICY IF EXISTS quote_candidates_authorized_select ON domain.quote_candidates;
CREATE POLICY quote_candidates_authorized_select
ON domain.quote_candidates
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM domain.quotes quote_row
    JOIN domain.customers customer ON customer.id = quote_row.customer_id
    WHERE quote_row.id = quote_candidates.quote_id
      AND customer.auth_user_id = identity.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM domain.contractor_users member
    WHERE member.contractor_company_id = quote_candidates.contractor_company_id
      AND member.auth_user_id = identity.uid()
      AND member.active
  )
  OR EXISTS (
    SELECT 1
    FROM domain.platform_admins admin_member
    WHERE admin_member.auth_user_id = identity.uid()
      AND admin_member.active
  )
);

CREATE OR REPLACE VIEW api.admin_order_overview
WITH (security_invoker = true)
AS
SELECT
  o.id,
  o.public_ref,
  o.status,
  o.requested_service_date,
  o.customer_total_cents,
  oa.contractor_company_id,
  cc.display_name AS contractor_name,
  pg.status AS payment_status,
  pg.platform_gross_retained_cents,
  pg.stripe_processing_fee_cents,
  pg.actual_platform_net_transaction_cents,
  o.updated_at,
  (poe.id IS NOT NULL) AS requires_admin_attention,
  poe.task_type AS failed_payment_operation
FROM domain.orders o
LEFT JOIN domain.order_assignments oa
  ON oa.order_id = o.id
 AND oa.released_at IS NULL
LEFT JOIN domain.contractor_companies cc
  ON cc.id = oa.contractor_company_id
LEFT JOIN domain.payment_generations pg
  ON pg.order_id = o.id
 AND pg.is_current
LEFT JOIN LATERAL (
  SELECT e.id, e.task_type
  FROM domain.payment_operation_exceptions e
  WHERE e.order_id = o.id
    AND e.status = 'OPEN'
  ORDER BY e.created_at DESC
  LIMIT 1
) poe ON true
WHERE EXISTS (
  SELECT 1
  FROM domain.platform_admins admin_member
  WHERE admin_member.auth_user_id = identity.uid()
    AND admin_member.active
);