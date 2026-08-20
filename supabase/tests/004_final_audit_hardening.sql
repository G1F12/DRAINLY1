begin;
grant usage on schema extensions to authenticated, drainly_system;
select extensions.no_plan();

-- Normalize the deterministic seed order in case this suite is executed on a
-- database previously used by the standalone concurrency test.
delete from domain.payment_operation_exceptions where order_id='91000000-0000-0000-0000-000000000001';
delete from internal.scheduled_tasks where aggregate_id in (
  select id from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001'
) or aggregate_id='91000000-0000-0000-0000-000000000001';
delete from internal.payment_attempts where payment_generation_id in (
  select id from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001'
);
delete from domain.financial_ledger_entries where order_id='91000000-0000-0000-0000-000000000001';
delete from domain.refunds where order_id='91000000-0000-0000-0000-000000000001';
delete from domain.job_proofs where order_id='91000000-0000-0000-0000-000000000001';
delete from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001';
delete from domain.order_assignments where order_id='91000000-0000-0000-0000-000000000001';
update domain.order_offers set status='OPEN', responded_at=null where order_id='91000000-0000-0000-0000-000000000001';
update domain.orders set status='SEARCHING_CONTRACTOR' where id='91000000-0000-0000-0000-000000000001';

select extensions.is(internal.max_worker_attempts(), 5, 'worker retry limit is centralized at five attempts');
select extensions.is(internal.safe_failure_code('request timed out for amy@example.test with sk_test_secret'),
  'OUTBOUND_PROVIDER_TIMEOUT', 'stored provider failure data is reduced to a safe timeout code');

-- Two firm-price orders can coexist while supply is apparent. Only acceptance
-- confirms a service date; capacity serialization still permits one winner.
insert into domain.quotes(id, idempotency_key, customer_id, status, service_region_id, tank_tier, timing_kind,
  access_type, requested_service_date, service_window_start_at, address_snapshot, service_notes,
  regional_price_book_version, marketplace_settings_version, customer_subtotal_cents, customer_fee_cents,
  customer_total_cents, estimated_payment_processing_cost_cents, expires_at, converted_at)
select '90000000-0000-0000-0000-000000000004', 'final-capacity-quote', customer_id, 'CONVERTED',
  service_region_id, tank_tier, timing_kind, access_type, requested_service_date, service_window_start_at,
  address_snapshot, service_notes, regional_price_book_version, marketplace_settings_version,
  customer_subtotal_cents, customer_fee_cents, customer_total_cents,
  estimated_payment_processing_cost_cents, expires_at, pg_catalog.now()
from domain.quotes where id = '90000000-0000-0000-0000-000000000001';

insert into domain.orders(id, public_ref, customer_id, property_id, quote_id, status, tank_tier, timing_kind,
  access_type, requested_service_date, service_window_start_at, address_snapshot, service_notes,
  customer_subtotal_cents, customer_fee_cents, customer_total_cents, marketplace_settings_version,
  regional_price_book_version, stripe_customer_id, stripe_payment_method_id, stripe_setup_intent_id)
select '91000000-0000-0000-0000-000000000004', 'DRN-FINAL-CAPACITY', customer_id, property_id,
  '90000000-0000-0000-0000-000000000004', 'SEARCHING_CONTRACTOR', tank_tier, timing_kind, access_type,
  requested_service_date, service_window_start_at, address_snapshot, service_notes, customer_subtotal_cents,
  customer_fee_cents, customer_total_cents, marketplace_settings_version, regional_price_book_version,
  stripe_customer_id, stripe_payment_method_id, 'seti_final_capacity'
from domain.orders where id = '91000000-0000-0000-0000-000000000001';

insert into domain.order_offers(id, order_id, contractor_company_id, expires_at,
  contractor_price_book_version, marketplace_settings_version, estimated_processing_rate_bps,
  estimated_processing_fixed_cents, minimum_contribution_margin_cents_applied, contractor_gross_cents,
  contractor_marketplace_fee_cents, contractor_payout_cents, platform_pricing_adjustment_cents,
  estimated_payment_processing_cost_cents, expected_platform_net_contribution_cents)
select '92000000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000004',
  contractor_company_id, pg_catalog.now() + interval '1 day', contractor_price_book_version,
  marketplace_settings_version, estimated_processing_rate_bps, estimated_processing_fixed_cents,
  minimum_contribution_margin_cents_applied, contractor_gross_cents, contractor_marketplace_fee_cents,
  contractor_payout_cents, platform_pricing_adjustment_cents, estimated_payment_processing_cost_cents,
  expected_platform_net_contribution_cents
from domain.order_offers where id = '92000000-0000-0000-0000-000000000001';

update domain.contractor_availability set max_jobs = 1
where contractor_company_id = '40000000-0000-0000-0000-000000000001'
  and iso_weekday = extract(isodow from (select requested_service_date from domain.orders
    where id = '91000000-0000-0000-0000-000000000001'))::integer;

select extensions.is((select count(*)::integer from domain.orders
  where id in ('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004')
    and status = 'SEARCHING_CONTRACTOR'), 2, 'two firm-price orders may coexist while contractor acceptance is pending');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select extensions.lives_ok(
  $$select api.accept_order_offer('92000000-0000-0000-0000-000000000001','final-capacity-winner')$$,
  'contractor acceptance confirms exactly one order');
select extensions.throws_ok(
  $$select api.accept_order_offer('92000000-0000-0000-0000-000000000004','final-capacity-loser')$$,
  'P0001', 'CAPACITY_EXHAUSTED', 'acceptance capacity serialization remains enforced');
set local role postgres;

select extensions.is((select status::text from domain.orders where id='91000000-0000-0000-0000-000000000001'),
  'SCHEDULED', 'only the accepted order becomes scheduled');
select extensions.is((select status::text from domain.orders where id='91000000-0000-0000-0000-000000000004'),
  'SEARCHING_CONTRACTOR', 'the unaccepted order remains searching and unconfirmed');

-- A poisoned outbox message has a bounded lifecycle, safe failure metadata,
-- and a TOTP-admin-only audited requeue that preserves historical attempts.
insert into internal.outbox_messages(id, topic, aggregate_type, aggregate_id, idempotency_key, payload)
values ('a6000000-0000-0000-0000-000000000001', 'booking.created', 'order',
  '91000000-0000-0000-0000-000000000004', 'final-poison-outbox',
  '{"orderId":"91000000-0000-0000-0000-000000000004"}');

set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-1', 20);
select extensions.is((select count(*)::integer from internal.claim_outbox('final-outbox-competing', 20)
  where id='a6000000-0000-0000-0000-000000000001'), 0,
  'a second worker cannot begin sending while the first outbox lease is valid');
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-1',false,
  'request timed out for amy@example.test bearer secret-value');
set local role postgres; update internal.outbox_messages set available_at=pg_catalog.now() where id='a6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-2', 20);
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-2',false,'permanent timeout');
set local role postgres; update internal.outbox_messages set available_at=pg_catalog.now() where id='a6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-3', 20);
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-3',false,'permanent timeout');
set local role postgres; update internal.outbox_messages set available_at=pg_catalog.now() where id='a6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-4', 20);
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-4',false,'permanent timeout');
set local role postgres; update internal.outbox_messages set available_at=pg_catalog.now() where id='a6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-5', 20);
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-5',false,'permanent timeout');
set local role postgres;

select extensions.is((select status::text from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  'FAILED', 'fifth deterministic provider failure terminates the outbox message');
select extensions.is((select attempts from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  5, 'outbox records the final attempt count');
select extensions.is((select last_error from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  'OUTBOUND_PROVIDER_TIMEOUT', 'outbox failure metadata contains no provider secrets or PII');
select extensions.ok((select failed_at is not null from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  'outbox records a terminal failure timestamp');
set local role drainly_system;
select extensions.is((select count(*)::integer from internal.claim_outbox('final-outbox-sixth',20)), 0,
  'FAILED outbox messages are not automatically claimed again');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select extensions.throws_ok(
  $$select api.requeue_failed_outbox('a6000000-0000-0000-0000-000000000001','customer cannot requeue poison','final-outbox-customer')$$,
  '42501', 'ADMIN_MFA_REQUIRED', 'customer cannot requeue a failed outbox item');
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.throws_ok(
  $$select api.requeue_failed_outbox('a6000000-0000-0000-0000-000000000001','short','final-outbox-short')$$,
  '22023', 'OUTBOX_REQUEUE_REASON_REQUIRED', 'admin requeue requires a human-readable reason');
select extensions.lives_ok(
  $$select api.requeue_failed_outbox('a6000000-0000-0000-0000-000000000001','verified provider correction','final-outbox-requeue')$$,
  'active TOTP admin can requeue one failed outbox item');
set local role postgres;
select extensions.is((select status::text from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  'PENDING', 'authorized requeue makes the outbox item eligible');
select extensions.is((select attempts from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  5, 'requeue preserves historical total attempts');
select extensions.ok(exists(select 1 from domain.audit_records where action='FAILED_OUTBOX_REQUEUED'
  and resource_id='a6000000-0000-0000-0000-000000000001'), 'outbox requeue creates immutable audit evidence');
set local role drainly_system;
select count(*) from internal.claim_outbox('final-outbox-requeued',20);
select internal.complete_outbox('a6000000-0000-0000-0000-000000000001','final-outbox-requeued',true,null);
set local role postgres;
select extensions.is((select status::text from internal.outbox_messages where id='a6000000-0000-0000-0000-000000000001'),
  'COMPLETED', 'successful post-requeue delivery converges normally');

-- Exhausted capture work preserves SERVICE_COMPLETED, creates an explicit
-- exception, cannot be automatically called a sixth time, and can be retried
-- only through the audited current-generation TOTP command.
select pg_catalog.set_config('test.final_generation_id',
  (select id::text from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001' and is_current), true);
delete from internal.scheduled_tasks where aggregate_id=current_setting('test.final_generation_id')::uuid;
update domain.orders set status='SERVICE_COMPLETED' where id='91000000-0000-0000-0000-000000000001';
update domain.payment_generations set status='CAPTURE_PENDING', provider_payment_intent_id='pi_final_recovery'
  where id=current_setting('test.final_generation_id')::uuid;
insert into internal.scheduled_tasks(id, task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
values ('b6000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','payment_generation',
  current_setting('test.final_generation_id')::uuid,pg_catalog.now(),'capture-final-exhaustion',
  pg_catalog.jsonb_build_object('paymentGenerationId',current_setting('test.final_generation_id')::uuid));

set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-1',20);
select internal.complete_work('b6000000-0000-0000-0000-000000000001','final-capture-1',false,'stripe timeout secret');
set local role postgres; update internal.scheduled_tasks set due_at=pg_catalog.now() where id='b6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-2',20);
select internal.complete_work('b6000000-0000-0000-0000-000000000001','final-capture-2',false,'stripe timeout');
set local role postgres; update internal.scheduled_tasks set due_at=pg_catalog.now() where id='b6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-3',20);
select internal.complete_work('b6000000-0000-0000-0000-000000000001','final-capture-3',false,'stripe timeout');
set local role postgres; update internal.scheduled_tasks set due_at=pg_catalog.now() where id='b6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-4',20);
select internal.complete_work('b6000000-0000-0000-0000-000000000001','final-capture-4',false,'stripe timeout');
set local role postgres; update internal.scheduled_tasks set due_at=pg_catalog.now() where id='b6000000-0000-0000-0000-000000000001';
set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-5',20);
select internal.complete_work('b6000000-0000-0000-0000-000000000001','final-capture-5',false,'stripe timeout');
set local role postgres;

select extensions.is((select status::text from internal.scheduled_tasks where id='b6000000-0000-0000-0000-000000000001'),
  'FAILED', 'five deterministic capture failures exhaust the financial task');
set local role drainly_system;
select extensions.is((select count(*)::integer from internal.claim_due_work('final-capture-sixth',20)), 0,
  'no automatic sixth capture provider call is claimable');
set local role postgres;
select extensions.is((select status::text from domain.orders where id='91000000-0000-0000-0000-000000000001'),
  'SERVICE_COMPLETED', 'terminal capture failure does not rewrite completed physical service history');
select extensions.ok(exists(select 1 from domain.payment_operation_exceptions where failed_task_id='b6000000-0000-0000-0000-000000000001'
  and status='OPEN'), 'terminal capture failure creates an explicit open operational exception');
select extensions.ok((select requires_admin_attention from api.admin_order_overview where id='91000000-0000-0000-0000-000000000001'),
  'admin order view visibly surfaces payment recovery attention');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select extensions.throws_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','customer recovery attempt','final-capture-customer')$$,
  '42501','ADMIN_MFA_REQUIRED','customer cannot retry a failed payment operation');
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select extensions.throws_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','contractor recovery attempt','final-capture-contractor')$$,
  '42501','ADMIN_MFA_REQUIRED','contractor cannot retry a failed payment operation');
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","aal":"aal1"}', true);
select extensions.throws_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','admin without mfa attempt','final-capture-no-mfa')$$,
  '42501','ADMIN_MFA_REQUIRED','admin without required MFA cannot retry payment');
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.throws_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','short','final-capture-short')$$,
  '22023','PAYMENT_RETRY_REASON_REQUIRED','TOTP admin payment retry still requires a reason');

set local role postgres;
update domain.payment_generations set is_current=false where id=current_setting('test.final_generation_id')::uuid;
set local role authenticated;
select extensions.throws_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','superseded generation attempt','final-capture-superseded')$$,
  'P0002','CURRENT_PAYMENT_GENERATION_REQUIRED','superseded payment generations cannot be recovered or captured');
set local role postgres;
update domain.payment_generations set is_current=true where id=current_setting('test.final_generation_id')::uuid;
set local role authenticated;
select extensions.lives_ok(
  $$select api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','operator verified safe capture retry','final-capture-retry')$$,
  'valid TOTP admin retry creates one fresh financial task');
select extensions.is(
  (select (api.retry_failed_payment_operation('91000000-0000-0000-0000-000000000001','CAPTURE_PAYMENT','operator verified safe capture retry','final-capture-retry')->>'duplicate')::boolean),
  true, 'duplicate retry command returns the existing task without duplication');
set local role postgres;
select extensions.is((select count(*)::integer from internal.scheduled_tasks where idempotency_key='admin-payment-retry:final-capture-retry'),
  1, 'duplicate retry command creates exactly one retry task');
select extensions.ok(exists(select 1 from domain.audit_records where action='FAILED_PAYMENT_OPERATION_RETRIED'
  and resource_id='91000000-0000-0000-0000-000000000001'), 'payment retry creates immutable audit evidence');

select pg_catalog.set_config('test.final_retry_task_id',
  (select id::text from internal.scheduled_tasks where idempotency_key='admin-payment-retry:final-capture-retry'), true);
set local role drainly_system;
select count(*) from internal.claim_due_work('final-capture-recovery-worker',20);
select internal.process_payment_webhook('evt_final_capture_recovery','payment_intent.succeeded',false,
  'final-recovery-sha','pi_final_recovery',1425);
select internal.complete_work(current_setting('test.final_retry_task_id')::uuid,'final-capture-recovery-worker',true,null);
select extensions.is(
  (select (internal.process_payment_webhook('evt_final_capture_recovery','payment_intent.succeeded',false,
    'final-recovery-sha','pi_final_recovery',1425)->>'duplicate')::boolean),
  true, 'duplicate capture webhook remains harmless after recovery');
set local role postgres;
select extensions.is((select status::text from domain.payment_generations where id=current_setting('test.final_generation_id')::uuid),
  'CAPTURED','successful recovery converges to authoritative captured payment state');
select extensions.is((select status::text from domain.orders where id='91000000-0000-0000-0000-000000000001'),
  'CLOSED','completed service closes after provider-confirmed recovery');
select extensions.is((select count(*)::integer from domain.financial_ledger_entries
  where payment_generation_id=current_setting('test.final_generation_id')::uuid and entry_type='CAPTURE'),
  1,'recovery and duplicate webhook produce exactly one capture effect');
select extensions.ok(exists(select 1 from domain.payment_operation_exceptions
  where failed_task_id='b6000000-0000-0000-0000-000000000001' and status='RESOLVED'),
  'provider-confirmed success resolves the operational exception');

select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated','internal.resolve_payment_operation_exceptions()','execute'),
  'internal.resolve_payment_operation_exceptions is trigger-only');

select * from extensions.finish();
rollback;
