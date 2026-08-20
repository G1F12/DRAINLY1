begin;
grant usage on schema extensions to authenticated, drainly_system;
select extensions.no_plan();

select extensions.ok(exists(select 1 from pg_catalog.pg_roles where rolname = 'drainly_system'), 'drainly_system exists');
select extensions.ok((select rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls from pg_catalog.pg_roles where rolname = 'drainly_system'), 'drainly_system is a constrained NOBYPASSRLS login');
select extensions.ok((select not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls from pg_catalog.pg_roles where rolname = 'drainly_routine_owner'), 'drainly_routine_owner is non-login and NOBYPASSRLS');
select extensions.is((select count(*)::integer from pg_catalog.pg_namespace where nspowner = 'drainly_routine_owner'::regrole), 0, 'routine owner owns no schemas');
select extensions.is((select count(*)::integer from pg_catalog.pg_class where relowner = 'drainly_routine_owner'::regrole), 0, 'routine owner owns no tables, views, sequences, or indexes');
select extensions.ok(not pg_catalog.has_schema_privilege('drainly_routine_owner', 'api', 'CREATE') and not pg_catalog.has_schema_privilege('drainly_routine_owner', 'internal', 'CREATE'), 'routine owner retains no schema creation privilege');
select extensions.is(
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api','internal') and p.prosecdef and p.proowner <> 'drainly_routine_owner'::regrole),
  0,
  'every privileged Drainly routine has the explicit routine owner'
);
select extensions.is(
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api','internal') and p.prosecdef and not (p.proconfig @> array['search_path=""']::text[])),
  0,
  'every privileged routine fixes search_path to empty'
);
select extensions.is(
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api','internal') and p.prosecdef and pg_catalog.has_function_privilege('public', p.oid, 'execute')),
  0,
  'PUBLIC executes no privileged routine'
);
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'domain.order_offers', 'UPDATE'), 'authenticated cannot update offers directly');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'domain.orders', 'UPDATE'), 'authenticated cannot update orders directly');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'domain.payment_generations', 'UPDATE'), 'authenticated cannot update payment generations directly');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'domain.refunds', 'INSERT'), 'authenticated cannot insert refunds directly');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_system', 'internal.scheduled_tasks', 'UPDATE'), 'drainly_system cannot mutate scheduled tasks directly');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_system', 'internal.webhook_events', 'INSERT'), 'drainly_system cannot insert webhook receipts directly');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.financial_ledger_entries', 'UPDATE'), 'routine owner cannot rewrite append-only ledger entries');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.order_events', 'UPDATE'), 'routine owner cannot rewrite append-only order events');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.audit_records', 'UPDATE'), 'routine owner cannot rewrite append-only audit records');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.marketplace_settings', 'INSERT'), 'routine owner cannot mutate marketplace configuration');
select extensions.ok(
  not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.admin_notes', 'SELECT')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.admin_notes', 'INSERT')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.admin_notes', 'UPDATE')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'domain.admin_notes', 'DELETE'),
  'routine owner has no unrelated admin-note privileges'
);
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'api.accept_order_offer(uuid,text)', 'execute'), 'authenticated can invoke atomic acceptance');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system', 'internal.claim_due_work(text,integer)', 'execute'), 'system login can invoke work leasing');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system', 'internal.begin_authorization(uuid)', 'execute'), 'system login can invoke the narrow authorization claim');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system', 'api.create_quote(text,domain.tank_tier,domain.timing_kind,domain.access_type,date,timestamp with time zone,jsonb,text,text)', 'execute'), 'trusted system route can invoke authoritative quote creation');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'api.create_quote(text,domain.tank_tier,domain.timing_kind,domain.access_type,date,timestamp with time zone,jsonb,text,text)', 'execute') and not pg_catalog.has_function_privilege('authenticated', 'api.create_quote(text,domain.tank_tier,domain.timing_kind,domain.access_type,date,timestamp with time zone,jsonb,text,text)', 'execute'), 'PostgREST callers cannot forge authoritative geography');
select extensions.ok(
  not pg_catalog.has_schema_privilege('drainly_routine_owner', 'auth', 'USAGE')
  and pg_catalog.has_function_privilege('drainly_routine_owner', 'identity.uid()', 'execute')
  and pg_catalog.has_function_privilege('drainly_routine_owner', 'identity.jwt()', 'execute'),
  'routine owner reaches trusted identity only through the narrow bridge'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('drainly_routine_owner', 'auth.users', 'SELECT')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'auth.users', 'INSERT')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'auth.users', 'UPDATE')
  and not pg_catalog.has_table_privilege('drainly_routine_owner', 'auth.users', 'DELETE'),
  'routine owner has no auth.users table privilege'
);
select extensions.ok(pg_catalog.has_function_privilege('drainly_routine_owner', 'extensions.gen_random_uuid()', 'execute'), 'routine owner has the required UUID default helper only');

set local role drainly_system;
select extensions.lives_ok(
  $$select api.create_quote('US-NC-JOHNSTON','GAL_1000','SCHEDULED','ATTENDED',current_date + 5,(current_date + 5 + time '08:00') at time zone 'America/New_York','{"addressLine1":"101 Test Road","city":"Smithfield","stateCode":"NC","postalCode":"27577","countyName":"Johnston County","normalizedAddress":"101 Test Road, Smithfield, NC","latitude":35.5,"longitude":-78.3}','db-security-quote',null)$$,
  'trusted server pricing routine performs its intended protected inserts'
);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","email":"amy.customer@example.test","aal":"aal1"}', true);
select extensions.throws_ok($$select api.create_quote('US-NC-JOHNSTON','GAL_1000','SCHEDULED','ATTENDED',current_date + 5,now(),'{}','forged-direct-quote',null)$$, '42501', null, 'authenticated caller cannot forge geography through the quote RPC');
select extensions.throws_ok($$insert into domain.quotes(status,tank_tier,timing_kind,access_type,requested_service_date,service_window_start_at,address_snapshot,expires_at) values ('UNAVAILABLE','GAL_1000','SCHEDULED','ATTENDED',current_date + 1,now(),'{}',now())$$, '42501', null, 'quote caller cannot insert the underlying table directly');
select extensions.lives_ok($$select api.ensure_customer_profile('+19195550101')$$, 'customer profile routine performs its intended upsert');
select extensions.throws_ok($$update domain.customers set phone = 'x'$$, '42501', null, 'customer profile caller cannot update customer rows directly');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{}', true);
select extensions.throws_ok($$select api.accept_order_offer('92000000-0000-0000-0000-000000000001','db-security-accept-unauthenticated')$$, '42501', 'AUTH_REQUIRED', 'unauthenticated caller cannot accept an offer');

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","email":"dual.owner@example.test","aal":"aal1"}', true);
select extensions.throws_ok($$select api.accept_order_offer('92000000-0000-0000-0000-000000000001','db-security-accept-other-company')$$, '42501', 'OFFER_NOT_OWNED', 'contractor from another company cannot accept the offer');

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"johnston.owner@example.test","aal":"aal1"}', true);
select extensions.lives_ok($$select api.accept_order_offer('92000000-0000-0000-0000-000000000001','db-security-accept')$$, 'contractor acceptance performs one protected assignment transaction');
select extensions.throws_ok($$update domain.order_offers set status = 'ACCEPTED' where id = '92000000-0000-0000-0000-000000000002'$$, '42501', null, 'offer caller cannot update offers directly');

set local role postgres;
select pg_catalog.set_config('test.payment_generation_id', (select id::text from domain.payment_generations where order_id = '91000000-0000-0000-0000-000000000001' and is_current), true);
set local role drainly_system;
select extensions.lives_ok(
  $$select internal.begin_authorization(current_setting('test.payment_generation_id')::uuid)$$,
  'internal.begin_authorization atomically claims only the current generation before provider work'
);
select extensions.throws_ok($$update domain.payment_generations set status = 'AUTHORIZATION_PENDING'$$, '42501', null, 'authorization invoker cannot claim a generation by updating it directly');
select extensions.lives_ok(
  $$select internal.record_authorization_result(current_setting('test.payment_generation_id')::uuid,'pi_test_security','AUTHORIZED',now() + interval '4 days',null)$$,
  'system authorization-result routine performs the intended protected update'
);
select extensions.throws_ok($$update domain.payment_generations set status = 'CAPTURED'$$, '42501', null, 'system caller cannot update payment generations directly');
select extensions.lives_ok($$select internal.get_payment_operation_context(current_setting('test.payment_generation_id')::uuid)$$, 'system payment context routine reads exactly the protected operation context');
select extensions.throws_ok($$select * from domain.payment_generations$$, '42501', null, 'system caller cannot select protected payment rows directly');
select extensions.lives_ok($$select internal.consume_rate_limit(repeat('a',64),2,60)$$, 'system rate-limit routine performs its intended protected upsert');
select extensions.throws_ok($$insert into internal.rate_limit_buckets values ('direct',now(),1,now())$$, '42501', null, 'system caller cannot mutate rate-limit storage directly');
select extensions.lives_ok($$select * from internal.claim_due_work('db-security-worker',20)$$, 'system work-claim routine performs its intended protected lease');
select extensions.throws_ok($$update internal.scheduled_tasks set status = 'COMPLETED'$$, '42501', null, 'system caller cannot mutate scheduled tasks directly');
set local role postgres;
select pg_catalog.set_config('test.scheduled_task_id', (select id::text from internal.scheduled_tasks where lease_owner = 'db-security-worker' limit 1), true);
set local role drainly_system;
select extensions.lives_ok($$select internal.complete_work(current_setting('test.scheduled_task_id')::uuid,'db-security-worker',true,null)$$, 'system completion routine completes only its owned lease');
select extensions.lives_ok($$select internal.process_payment_webhook('evt_security_auth','payment_intent.amount_capturable_updated',false,repeat('b',64),'pi_test_security',null)$$, 'system webhook routine records and applies an idempotent provider event');
select extensions.throws_ok($$insert into internal.webhook_events(provider,provider_event_id,event_type,livemode,payload_sha256) values ('STRIPE','direct','x',false,'x')$$, '42501', null, 'system caller cannot insert webhook receipts directly');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","email":"johnston.owner@example.test","aal":"aal1"}', true);
select extensions.lives_ok($$select api.transition_job('91000000-0000-0000-0000-000000000001','MARK_EN_ROUTE',null,'db-security-enroute')$$, 'contractor transition routine performs the authorized protected state change');
select extensions.throws_ok($$update domain.orders set status = 'ARRIVED' where id = '91000000-0000-0000-0000-000000000001'$$, '42501', null, 'job actor cannot mutate orders directly');
select extensions.lives_ok($$select api.register_job_proof('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001/proof.jpg','image/jpeg',100,repeat('a',64),'db-security-proof')$$, 'proof registration routine performs its intended protected insert');
select extensions.throws_ok($$insert into domain.job_proofs(order_id,assignment_id,storage_path,mime_type,size_bytes,checksum_sha256,uploaded_by) values ('91000000-0000-0000-0000-000000000001',(select id from domain.order_assignments where order_id='91000000-0000-0000-0000-000000000001'),'direct.jpg','image/jpeg',10,repeat('a',64),'20000000-0000-0000-0000-000000000001')$$, '42501', null, 'proof caller cannot insert proof metadata directly');

set local role postgres;
select pg_catalog.set_config('test.proof_id', (select id::text from domain.job_proofs where order_id='91000000-0000-0000-0000-000000000001' limit 1), true);
set local role drainly_system;
select extensions.lives_ok($$select internal.verify_job_proof(current_setting('test.proof_id')::uuid,true,null)$$, 'proof verification routine performs only the protected verification update');
select extensions.throws_ok($$update domain.job_proofs set status='VERIFIED'$$, '42501', null, 'system caller cannot verify proof metadata directly');

set local role postgres;
update domain.order_offers set status = 'OPEN', responded_at = null where id = '92000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","email":"dual.owner@example.test","aal":"aal1"}', true);
select extensions.lives_ok($$select api.decline_order_offer('92000000-0000-0000-0000-000000000002','db-security-decline')$$, 'decline routine performs its intended protected offer update');
select extensions.throws_ok($$update domain.order_offers set status='DECLINED'$$, '42501', null, 'decline caller cannot update offer rows directly');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"otp"}]}', true);
select extensions.throws_ok($$select api.admin_override_authorization('91000000-0000-0000-0000-000000000001','Attempt without a TOTP factor','db-security-non-totp')$$, '42501', null, 'aal2 without a TOTP authentication method cannot invoke admin commands');
select pg_catalog.set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","email":"ops.admin@example.test","aal":"aal2","amr":[{"method":"totp"}]}', true);
select extensions.lives_ok($$select api.admin_override_authorization('91000000-0000-0000-0000-000000000001','Documented pilot exception for test','db-security-override')$$, 'MFA admin override performs its narrow protected mutation and audit');
select extensions.throws_ok($$update domain.payment_generations set authorization_override = true$$, '42501', null, 'admin invoker cannot directly mutate authorization state');

set local role postgres;
select extensions.ok(not pg_catalog.has_table_privilege('authenticated','domain.order_assignments','INSERT'), 'reassignment invoker cannot insert assignments directly');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_system','domain.order_assignments','INSERT'), 'system finalize invoker cannot insert assignments directly');
select extensions.ok(pg_catalog.has_function_privilege('authenticated','api.reassign_order(uuid,uuid,text,text)','execute'), 'MFA admin may invoke bounded reassignment routine');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system','internal.finalize_reassignment(uuid)','execute'), 'system may invoke bounded reassignment finalizer');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system','internal.record_cancellation_and_finalize(uuid)','execute'), 'system may invoke cancellation finalizer');
select extensions.ok(pg_catalog.has_function_privilege('authenticated','api.request_refund(uuid,integer,text,text)','execute'), 'MFA admin may invoke bounded refund request routine');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system','internal.get_refund_context(uuid)','execute'), 'system may read bounded refund context');
select extensions.ok(pg_catalog.has_function_privilege('drainly_system','internal.record_refund_result(uuid,text,domain.refund_status,integer,text)','execute'), 'system may record bounded refund result');
select extensions.ok(not pg_catalog.has_table_privilege('drainly_system','domain.financial_ledger_entries','INSERT'), 'system cannot insert financial ledger entries directly');

select * from extensions.finish();
rollback;
