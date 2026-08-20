begin;
grant usage on schema extensions to authenticated, drainly_system;
select extensions.no_plan();

select extensions.ok(
  not pg_catalog.has_function_privilege('drainly_system', 'internal.schedule_assignment_deadline()', 'execute'),
  'internal.schedule_assignment_deadline is trigger-only and not a system RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege('drainly_system', 'internal.process_assignment_deadline(uuid)', 'execute'),
  'internal.process_assignment_deadline is available only through the worker role'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('drainly_system', 'internal.release_failed_order_payment()', 'execute'),
  'internal.release_failed_order_payment is trigger-only and not a system RPC'
);

select extensions.ok(
  exists (select 1 from internal.scheduled_tasks where task_type = 'CHECK_ASSIGNMENT_DEADLINE'
    and aggregate_id = '91000000-0000-0000-0000-000000000001'),
  'booking insert durably schedules a no-assignment authorization deadline'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"johnston.owner@example.test","aal":"aal1"}', true);
select extensions.lives_ok(
  $$select api.accept_order_offer('92000000-0000-0000-0000-000000000001','audit-race-accept')$$,
  'fixture assignment creates its own payment generation'
);

set local role postgres;
select pg_catalog.set_config('test.audit_generation_id',
  (select id::text from domain.payment_generations where order_id = '91000000-0000-0000-0000-000000000001' and is_current), true);

-- Failed physical work releases capacity and cannot leave a customer hold.
update domain.payment_generations set status = 'AUTHORIZED', provider_payment_intent_id = 'pi_audit_failed_service'
  where id = current_setting('test.audit_generation_id')::uuid;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"johnston.owner@example.test","aal":"aal1"}', true);
select extensions.lives_ok(
  $$select api.transition_job('91000000-0000-0000-0000-000000000001','FAIL_SERVICE','equipment failure','audit-failed-service')$$,
  'failed service transition releases capacity and queues authorization cancellation'
);
set local role postgres;
select extensions.is((select status::text from domain.payment_generations where id=current_setting('test.audit_generation_id')::uuid),
  'CANCELLATION_PENDING', 'failed service cannot retain an authorized hold');
select extensions.ok(exists(select 1 from domain.order_assignments where order_id='91000000-0000-0000-0000-000000000001' and released_at is not null),
  'failed service releases the active capacity assignment');
update domain.orders set status='SCHEDULED' where id='91000000-0000-0000-0000-000000000001';
update domain.order_assignments set released_at=null, release_reason=null where order_id='91000000-0000-0000-0000-000000000001';
update domain.payment_generations set status='REQUESTED', provider_payment_intent_id=null where id=current_setting('test.audit_generation_id')::uuid;
delete from internal.scheduled_tasks where idempotency_key='cancel-order:' || current_setting('test.audit_generation_id');

-- Once physical service is complete, cancellation must not race capture; the
-- order must capture and then use the refund lifecycle.
update domain.orders set status = 'SERVICE_COMPLETED' where id = '91000000-0000-0000-0000-000000000001';
update domain.payment_generations set status = 'CAPTURE_PENDING' where id = current_setting('test.audit_generation_id')::uuid;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.throws_ok(
  $$select api.cancel_order('91000000-0000-0000-0000-000000000001','post-service cancellation is forbidden','audit-post-service-cancel')$$,
  'P0001', 'ORDER_NOT_CANCELLABLE_AFTER_SERVICE',
  'post-service cancellation cannot race an authoritative capture'
);

-- Rewind only the transaction-local fixture to reproduce cancellation while
-- the authorization provider call is outside the database transaction.
set local role postgres;
update domain.orders set status = 'SCHEDULED' where id = '91000000-0000-0000-0000-000000000001';
update domain.payment_generations set status = 'AUTHORIZATION_PENDING', provider_payment_intent_id = null
  where id = current_setting('test.audit_generation_id')::uuid;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok(
  $$select api.cancel_order('91000000-0000-0000-0000-000000000001','cancel while authorization is in flight','audit-inflight-cancel')$$,
  'cancellation preserves an in-flight authorization generation until its provider result is persisted'
);

set local role drainly_system;
select extensions.lives_ok(
  $$select internal.record_authorization_result(current_setting('test.audit_generation_id')::uuid,'pi_audit_orphan_guard','AUTHORIZED',now()+interval '4 days',null)$$,
  'late authorization result is persisted and queued for cancellation'
);

set local role postgres;
select extensions.is(
  (select status::text from domain.payment_generations where id = current_setting('test.audit_generation_id')::uuid),
  'CANCELLATION_PENDING',
  'canceled order cannot orphan an authorized provider intent'
);
select extensions.is(
  (select count(*)::integer from internal.scheduled_tasks where task_type = 'CANCEL_ORDER_AUTHORIZATION'
    and aggregate_id = current_setting('test.audit_generation_id')::uuid),
  1,
  'exactly one cancellation task is created for the late provider result'
);

select * from extensions.finish();
rollback;
