begin;
grant usage on schema extensions to authenticated, drainly_system;
select extensions.no_plan();

-- Provider-verified SetupIntent plus authoritative booking re-evaluation.
set local role drainly_system;
select extensions.lives_ok(
  $$select api.create_quote('US-NC-HARNETT','GAL_1250','SCHEDULED','ATTENDED',
    current_date + ((8 - extract(isodow from current_date)::integer) % 7) + 7,
    (current_date + ((8 - extract(isodow from current_date)::integer) % 7) + 7 + time '08:00') at time zone 'America/New_York',
    '{"addressLine1":"202 Matrix Lane","city":"Lillington","stateCode":"NC","postalCode":"27546","countyName":"Harnett County","normalizedAddress":"202 Matrix Lane, Lillington, NC","latitude":35.4,"longitude":-78.8,"accessInstructions":"Customer present"}',
    'matrix-quote-idempotency', 'matrix-booking')$$,
  'trusted api.create_quote path performs protected quote and candidate inserts'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","email":"ben.customer@example.test","aal":"aal1"}', true);
select extensions.throws_ok($$insert into domain.quote_candidates(quote_id,contractor_company_id,rank,contractor_price_book_version,contractor_gross_cents,contractor_marketplace_fee_cents,contractor_payout_cents,stripe_transfer_amount_cents,platform_gross_retained_cents,platform_pricing_adjustment_cents,estimated_payment_processing_cost_cents,expected_platform_net_contribution_cents,meets_guardrail) values ((select id from domain.quotes limit 1),'40000000-0000-0000-0000-000000000002',99,1,1,0,1,1,1,0,0,0,true)$$, '42501', null, 'quote invoker cannot insert candidate rows directly');

set local role postgres;
select pg_catalog.set_config('test.booking_quote_id', (select id::text from domain.quotes where service_notes='matrix-booking' and status='PRICED' order by created_at desc limit 1), true);
set local role drainly_system;
select extensions.lives_ok(
  $$select internal.record_verified_setup_intent('10000000-0000-0000-0000-000000000002','seti_matrix_booking','cus_matrix_booking','pm_matrix_booking','succeeded','off_session','pilot-v1',now())$$,
  'internal.record_verified_setup_intent performs its narrow trusted insert'
);
select extensions.throws_ok($$insert into internal.verified_setup_intents(setup_intent_id,auth_user_id,stripe_customer_id,payment_method_id,provider_status,usage,consent_version,consent_recorded_at) values ('direct','10000000-0000-0000-0000-000000000002','cus','pm','succeeded','off_session','pilot-v1',now())$$, '42501', null, 'system invoker cannot insert verified setup rows directly');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","email":"ben.customer@example.test","aal":"aal1"}', true);
select extensions.lives_ok(
  $$select api.create_booking(current_setting('test.booking_quote_id')::uuid,'cus_matrix_booking','pm_matrix_booking','seti_matrix_booking','matrix-booking-idempotency')$$,
  'api.create_booking consumes only a verified setup and performs protected booking writes'
);
select extensions.throws_ok($$insert into domain.orders(customer_id,property_id,quote_id,tank_tier,timing_kind,access_type,requested_service_date,service_window_start_at,address_snapshot,customer_subtotal_cents,customer_fee_cents,customer_total_cents,marketplace_settings_version,regional_price_book_version) select customer_id,property_id,quote_id,tank_tier,timing_kind,access_type,requested_service_date,service_window_start_at,address_snapshot,customer_subtotal_cents,customer_fee_cents,customer_total_cents,marketplace_settings_version,regional_price_book_version from domain.orders limit 1$$, '42501', null, 'booking invoker cannot insert orders directly');

-- Admin economics override never waives payout funding.
set local role postgres;
insert into domain.quotes(id, customer_id, status, service_region_id, tank_tier, timing_kind, access_type, requested_service_date,
  service_window_start_at, address_snapshot, regional_price_book_version, marketplace_settings_version,
  customer_subtotal_cents, customer_fee_cents, customer_total_cents, estimated_payment_processing_cost_cents, expires_at)
values ('a0000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','REVIEW_REQUIRED',
  '50000000-0000-0000-0000-000000000001','GAL_1000','SCHEDULED','ATTENDED',current_date + 14,
  (current_date + 14 + time '08:00') at time zone 'America/New_York','{}',1,1,36500,0,36500,1125,now()+interval '30 minutes');
insert into domain.quote_candidates(quote_id,contractor_company_id,rank,contractor_price_book_version,contractor_gross_cents,
  contractor_marketplace_fee_cents,contractor_payout_cents,stripe_transfer_amount_cents,platform_gross_retained_cents,
  platform_pricing_adjustment_cents,estimated_payment_processing_cost_cents,expected_platform_net_contribution_cents,meets_guardrail)
values ('a0000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,1,36000,0,36000,36000,500,500,1125,-625,false);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok($$select api.admin_override_quote_economics('a0000000-0000-0000-0000-000000000001',-1000,'Documented matrix economics decision','matrix-economics-override')$$, 'api.admin_override_quote_economics performs the bounded quote mutation and audit');
select extensions.throws_ok($$update domain.quotes set status='PRICED' where id='a0000000-0000-0000-0000-000000000001'$$, '42501', null, 'economics override invoker cannot update quotes directly');
select extensions.throws_ok($$select api.admin_override_quote_economics('a0000000-0000-0000-0000-000000000001',-100000,'Second invalid override attempt','matrix-invalid-override')$$, 'P0001', null, 'economics override cannot bypass quote preconditions');

set local role postgres;
insert into domain.contractor_verifications(contractor_company_id,verification_type,status,reference,verified_at)
values ('40000000-0000-0000-0000-000000000004','PILOT_APPROVAL','VERIFIED','MATRIX-APPROVAL',now());
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok($$select api.admin_set_contractor_status('40000000-0000-0000-0000-000000000004','APPROVED','Approved for matrix security verification','matrix-contractor-approval')$$, 'api.admin_set_contractor_status performs its intended audited status mutation');
select extensions.throws_ok($$update domain.contractor_companies set status='DISABLED' where id='40000000-0000-0000-0000-000000000004'$$, '42501', null, 'admin status invoker cannot update contractor rows directly');

-- Reassignment after authorization: release, cancellation confirmation, then replacement generation.
set local role postgres;
insert into domain.quotes(id, customer_id, status, service_region_id, tank_tier, timing_kind, access_type, requested_service_date,
  service_window_start_at, address_snapshot, regional_price_book_version, marketplace_settings_version,
  customer_subtotal_cents, customer_fee_cents, customer_total_cents, estimated_payment_processing_cost_cents, expires_at, converted_at)
values ('a0000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','CONVERTED',
  '50000000-0000-0000-0000-000000000001','GAL_1000','SCHEDULED','ATTENDED',current_date + 14,
  (current_date + 14 + time '08:00') at time zone 'America/New_York','{}',1,1,36500,0,36500,1125,now()+interval '30 minutes',now());
insert into domain.orders(id,public_ref,customer_id,property_id,quote_id,status,tank_tier,timing_kind,access_type,requested_service_date,
  service_window_start_at,address_snapshot,customer_subtotal_cents,customer_fee_cents,customer_total_cents,marketplace_settings_version,
  regional_price_book_version,stripe_customer_id,stripe_payment_method_id,stripe_setup_intent_id)
values ('a1000000-0000-0000-0000-000000000002','DRN-MATRIX-REASSIGN','11000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','SCHEDULED','GAL_1000','SCHEDULED','ATTENDED',
  current_date + 14,(current_date + 14 + time '08:00') at time zone 'America/New_York','{}',36500,0,36500,1,1,'cus_matrix','pm_matrix','seti_matrix');
insert into domain.order_assignments(id,order_id,contractor_company_id)
values ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001');
insert into domain.payment_generations(id,order_id,assignment_id,generation_number,status,connected_account_id,
  contractor_price_book_version,marketplace_settings_version,estimated_processing_rate_bps,estimated_processing_fixed_cents,minimum_contribution_margin_cents_applied,customer_total_cents,
  contractor_gross_cents,contractor_marketplace_fee_cents,contractor_payout_cents,stripe_transfer_amount_cents,platform_gross_retained_cents,
  platform_pricing_adjustment_cents,estimated_payment_processing_cost_cents,expected_platform_net_contribution_cents,provider_payment_intent_id,authorization_target_at)
values ('a3000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002',1,
  'AUTHORIZED','acct_test_johnston',1,1,300,30,1000,36500,32500,3250,29250,29250,7250,4000,1125,6125,'pi_matrix_old',now());

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok($$select api.reassign_order('a1000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','Contractor unavailable before service','matrix-reassign-authorized')$$, 'api.reassign_order blocks service and queues old authorization cancellation');
select extensions.throws_ok($$insert into domain.order_assignments(order_id,contractor_company_id) values ('a1000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003')$$, '42501', null, 'reassignment invoker cannot insert assignments directly');

set local role drainly_system;
select extensions.lives_ok($$select internal.record_cancellation_and_finalize('a3000000-0000-0000-0000-000000000002')$$, 'internal.record_cancellation_and_finalize confirms release and creates only the replacement generation');
select extensions.throws_ok($$update domain.order_assignments set released_at=null where id='a2000000-0000-0000-0000-000000000002'$$, '42501', null, 'system finalizer invoker cannot update assignments directly');
set local role postgres;
select extensions.is((select connected_account_id from domain.payment_generations where order_id='a1000000-0000-0000-0000-000000000002' and is_current), 'acct_test_dual', 'replacement generation targets only the replacement account');
select extensions.is((select status::text from domain.payment_generations where id='a3000000-0000-0000-0000-000000000002'), 'SUPERSEDED', 'old authorized generation is superseded');

-- Payment attempt, refund, reconciliation, and dispute routines on an immutable captured generation.
set local role postgres;
update domain.orders set status='CLOSED' where id='a1000000-0000-0000-0000-000000000002';
update domain.payment_generations set is_current=false where order_id='a1000000-0000-0000-0000-000000000002';
update domain.payment_generations set is_current=true,status='CAPTURED',provider_payment_intent_id='pi_matrix_captured'
  where order_id='a1000000-0000-0000-0000-000000000002' and generation_number=2;
insert into domain.financial_ledger_entries(order_id,payment_generation_id,entry_type,amount_cents,provider_reference,occurred_at)
select order_id,id,'CAPTURE',customer_total_cents,'pi_matrix_captured',now() from domain.payment_generations
  where order_id='a1000000-0000-0000-0000-000000000002' and generation_number=2;
insert into domain.financial_ledger_entries(order_id,payment_generation_id,entry_type,amount_cents,provider_reference,occurred_at)
select order_id,id,'CONTRACTOR_TRANSFER',stripe_transfer_amount_cents,'pi_matrix_captured:transfer',now() from domain.payment_generations
  where order_id='a1000000-0000-0000-0000-000000000002' and generation_number=2;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok($$select api.request_refund('a1000000-0000-0000-0000-000000000002',10000,'Documented partial refund','matrix-refund-request')$$, 'api.request_refund creates only a bounded refund request');
select extensions.throws_ok($$insert into domain.refunds(order_id,payment_generation_id,amount_cents,reason,idempotency_key) select order_id,id,1,'direct','direct-refund' from domain.payment_generations where provider_payment_intent_id='pi_matrix_captured'$$, '42501', null, 'refund invoker cannot insert refunds directly');

set local role postgres;
select pg_catalog.set_config('test.refund_id', (select id::text from domain.refunds where idempotency_key='matrix-refund-request'), true);
select pg_catalog.set_config('test.captured_generation_id', (select id::text from domain.payment_generations where provider_payment_intent_id='pi_matrix_captured'), true);
set local role drainly_system;
select extensions.lives_ok($$select internal.get_refund_context(current_setting('test.refund_id')::uuid)$$, 'internal.get_refund_context returns only a pending refund operation');
select extensions.throws_ok($$select * from domain.refunds$$, '42501', null, 'system refund context invoker cannot select refund rows directly');
select extensions.lives_ok($$select internal.record_refund_result(current_setting('test.refund_id')::uuid,'re_matrix_partial','PENDING',null,null)$$, 'internal.record_refund_result persists a non-terminal provider response');
select extensions.lives_ok($$select internal.process_refund_webhook('evt_matrix_refund_succeeded','refund.updated',false,repeat('f',64),'re_matrix_partial','succeeded',8000)$$, 'internal.process_refund_webhook advances a pending refund and appends the actual reversal ledger entries');
select extensions.throws_ok($$insert into domain.financial_ledger_entries(order_id,entry_type,amount_cents,occurred_at) values ('a1000000-0000-0000-0000-000000000002','CUSTOMER_REFUND',1,now())$$, '42501', null, 'refund-result invoker cannot insert ledger entries directly');
select extensions.lives_ok($$select internal.begin_payment_attempt(current_setting('test.captured_generation_id')::uuid,'CAPTURE','matrix-payment-attempt')$$, 'internal.begin_payment_attempt performs its intended protected insert');
set local role postgres;
select pg_catalog.set_config('test.payment_attempt_id', (select id::text from internal.payment_attempts where idempotency_key='matrix-payment-attempt'), true);
set local role drainly_system;
select extensions.lives_ok($$select internal.complete_payment_attempt(current_setting('test.payment_attempt_id')::uuid,true,'pi_matrix_captured',null)$$, 'internal.complete_payment_attempt performs its intended bounded update');
select extensions.throws_ok($$update internal.payment_attempts set status='FAILED'$$, '42501', null, 'system payment-attempt invoker cannot update attempts directly');
select extensions.lives_ok($$select internal.record_reconciliation_result(current_setting('test.captured_generation_id')::uuid,1125)$$, 'internal.record_reconciliation_result records actual fee and derived net');
select extensions.throws_ok($$insert into internal.reconciliation_runs(period_start,period_end) values (now()-interval '1 minute',now())$$, '42501', null, 'system reconciliation invoker cannot insert runs directly');
select extensions.lives_ok($$select internal.process_dispute_webhook('evt_matrix_dispute','charge.dispute.created',false,repeat('d',64),'dp_matrix','pi_matrix_captured',5000,'needs_response',1500)$$, 'internal.process_dispute_webhook records an operational dispute without rewriting service history');
select extensions.throws_ok($$insert into internal.provider_disputes(provider_dispute_id,amount_cents,provider_status) values ('dp_direct',1,'x')$$, '42501', null, 'system dispute invoker cannot insert provider disputes directly');

-- Proof read/verify and outbox delivery routines.
set local role postgres;
insert into domain.job_proofs(id,order_id,assignment_id,storage_path,mime_type,size_bytes,checksum_sha256,uploaded_by)
select 'a4000000-0000-0000-0000-000000000002',oa.order_id,oa.id,oa.order_id::text||'/matrix.jpg','image/jpeg',100,repeat('e',64),'20000000-0000-0000-0000-000000000003'
from domain.order_assignments oa where oa.order_id='a1000000-0000-0000-0000-000000000002' and oa.released_at is null;
insert into internal.outbox_messages(id,topic,aggregate_type,aggregate_id,idempotency_key,payload)
values ('a5000000-0000-0000-0000-000000000002','assignment.created','order','a1000000-0000-0000-0000-000000000002','matrix-outbox','{}');

set local role drainly_system;
select extensions.lives_ok($$select internal.get_proof_verification_context('a4000000-0000-0000-0000-000000000002')$$, 'internal.get_proof_verification_context returns only expected pending proof metadata');
select extensions.lives_ok($$select internal.verify_job_proof('a4000000-0000-0000-0000-000000000002',true,null)$$, 'internal.verify_job_proof performs only its intended verification');
select extensions.throws_ok($$update domain.job_proofs set status='VERIFIED'$$, '42501', null, 'proof system invoker cannot update proofs directly');
select extensions.lives_ok($$select * from internal.claim_outbox('matrix-outbox-worker',20)$$, 'internal.claim_outbox leases due messages');
select extensions.lives_ok($$select internal.get_outbox_delivery_context('a5000000-0000-0000-0000-000000000002','matrix-outbox-worker')$$, 'internal.get_outbox_delivery_context returns only an owned lease context');
select extensions.lives_ok($$select internal.begin_notification_delivery('a5000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','CUSTOMER','EMAIL','assignment.created',repeat('f',64))$$, 'internal.begin_notification_delivery creates an idempotent protected delivery');
set local role postgres;
select pg_catalog.set_config('test.notification_id', (select id::text from domain.notifications where idempotency_key like 'a5000000-0000-0000-0000-000000000002:%'), true);
set local role drainly_system;
select extensions.lives_ok($$select internal.complete_notification_delivery(current_setting('test.notification_id')::uuid,true,null)$$, 'internal.complete_notification_delivery performs its intended protected update');
select extensions.throws_ok($$insert into domain.notifications(recipient_type,channel,template_key,idempotency_key,destination_hash) values ('ADMIN','EMAIL','x','direct',repeat('f',64))$$, '42501', null, 'system notification invoker cannot insert notifications directly');
select extensions.lives_ok($$select internal.complete_outbox('a5000000-0000-0000-0000-000000000002','matrix-outbox-worker',true,null)$$, 'internal.complete_outbox completes only its owned lease');
select extensions.throws_ok($$update internal.outbox_messages set status='COMPLETED'$$, '42501', null, 'system outbox invoker cannot update outbox rows directly');

-- Explicit order cancellation/release through customer and system paths.
set local role postgres;
update domain.orders set status='SCHEDULED' where id='a1000000-0000-0000-0000-000000000002';
update domain.payment_generations set status='AUTHORIZED',is_current=true where provider_payment_intent_id='pi_matrix_captured';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","email":"amy.customer@example.test","aal":"aal1"}', true);
select extensions.lives_ok($$select api.cancel_order('a1000000-0000-0000-0000-000000000002','Customer requested cancellation','matrix-order-cancel')$$, 'api.cancel_order performs the authorized protected cancellation');
select extensions.throws_ok($$update domain.orders set status='CANCELLED' where id='a1000000-0000-0000-0000-000000000002'$$, '42501', null, 'cancellation invoker cannot update orders directly');
set local role drainly_system;
select extensions.lives_ok($$select internal.record_order_cancellation_release(current_setting('test.captured_generation_id')::uuid)$$, 'internal.record_order_cancellation_release records confirmed provider release');
select extensions.throws_ok($$update domain.payment_generations set status='CANCELLED' where provider_payment_intent_id='pi_matrix_captured'$$, '42501', null, 'release invoker cannot update payment rows directly');

select * from extensions.finish();
rollback;
