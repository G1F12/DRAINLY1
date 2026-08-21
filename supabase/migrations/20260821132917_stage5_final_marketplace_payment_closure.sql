begin;

create or replace function internal.contractor_test_payment_ready(p_contractor_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from domain.contractor_companies cc
    where cc.id = p_contractor_company_id
      and cc.stripe_connected_account_id is not null
      and cc.stripe_connect_environment = 'SANDBOX'
      and cc.stripe_connect_ready
      and cc.stripe_transfer_capability_status = 'active'
  )
$function$;

create or replace function internal.assert_pilot_booking_execution(p_customer_total_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_control domain.pilot_controls%rowtype;
begin
  select * into strict v_control from domain.pilot_controls pc where pc.id = 1;
  if not v_control.booking_execution_enabled or v_control.allowed_payment_mode <> 'STRIPE_TEST' then
    raise exception using errcode = 'P0001', message = 'PILOT_BOOKING_EXECUTION_DISABLED';
  end if;
  if p_customer_total_cents is null or p_customer_total_cents <= 0 or p_customer_total_cents > v_control.max_customer_total_cents then
    raise exception using errcode = '23514', message = 'PILOT_CUSTOMER_TOTAL_LIMIT_EXCEEDED';
  end if;
end
$function$;

create or replace function internal.assert_pilot_payment_execution()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_control domain.pilot_controls%rowtype;
begin
  select * into strict v_control from domain.pilot_controls pc where pc.id = 1;
  if not v_control.payment_execution_enabled or v_control.allowed_payment_mode <> 'STRIPE_TEST' then
    raise exception using errcode = 'P0001', message = 'PILOT_PAYMENT_EXECUTION_DISABLED';
  end if;
end
$function$;

create or replace function internal.marketplace_ranked_candidates(
  p_service_region_id uuid,
  p_tank_tier domain.tank_tier,
  p_timing_kind domain.timing_kind,
  p_requested_service_date date
)
returns table(
  rank integer,
  contractor_company_id uuid,
  contractor_price_book_version integer,
  contractor_gross_cents integer,
  assigned_jobs bigint,
  max_jobs integer,
  utilization numeric,
  priority integer,
  payment_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with candidate_base as (
    select
      cc.id as contractor_company_id,
      cpb.version as contractor_price_book_version,
      priced.contractor_gross_cents,
      ca.max_jobs,
      cc.priority,
      (
        select pg_catalog.count(*)
        from domain.order_assignments oa
        join domain.orders o on o.id = oa.order_id
        where oa.contractor_company_id = cc.id
          and oa.released_at is null
          and o.requested_service_date = p_requested_service_date
      ) as assigned_jobs,
      internal.contractor_test_payment_ready(cc.id) as payment_ready
    from domain.contractor_companies cc
    join domain.contractor_service_regions csr
      on csr.contractor_company_id = cc.id
     and csr.service_region_id = p_service_region_id
    join domain.contractor_availability ca
      on ca.contractor_company_id = cc.id
     and ca.iso_weekday = extract(isodow from p_requested_service_date)::integer
    join domain.contractor_price_books cpb
      on cpb.contractor_company_id = cc.id
     and cpb.active
    join lateral (
      select cpr.contractor_gross_cents
      from domain.contractor_price_rules cpr
      where cpr.price_book_id = cpb.id
        and cpr.tank_tier = p_tank_tier
        and cpr.timing_kind = p_timing_kind
        and (cpr.service_region_id is null or cpr.service_region_id = p_service_region_id)
      order by (cpr.service_region_id is not null) desc
      limit 1
    ) priced on true
    where cc.status = 'APPROVED'
      and ca.max_jobs > 0
      and (p_timing_kind <> 'URGENT' or ca.urgent_enabled)
      and not exists (
        select 1
        from domain.contractor_blackout_dates cbd
        where cbd.contractor_company_id = cc.id
          and cbd.blackout_date = p_requested_service_date
      )
  ), eligible as (
    select cb.*, (cb.assigned_jobs::numeric / greatest(cb.max_jobs, 1)) as utilization
    from candidate_base cb
    where cb.assigned_jobs < cb.max_jobs
  )
  select
    row_number() over (order by e.contractor_gross_cents asc, e.utilization asc, e.priority asc, e.contractor_company_id asc)::integer as rank,
    e.contractor_company_id,
    e.contractor_price_book_version,
    e.contractor_gross_cents,
    e.assigned_jobs,
    e.max_jobs,
    e.utilization,
    e.priority,
    e.payment_ready
  from eligible e
  order by rank
$function$;

create or replace function api.pilot_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_control domain.pilot_controls%rowtype;
  v_total integer := 0;
  v_approved integer := 0;
  v_verification_ready integer := 0;
  v_dispatch_ready integer := 0;
  v_payment_ready integer := 0;
  v_region_count integer := 0;
  v_regional_rule_count integer := 0;
  v_marketplace_settings_ready boolean := false;
begin
  select * into strict v_control from domain.pilot_controls pc where pc.id = 1;
  select pg_catalog.count(*)::integer into v_total from domain.contractor_companies;
  select pg_catalog.count(*)::integer into v_approved from domain.contractor_companies cc where cc.status = 'APPROVED';
  select pg_catalog.count(*)::integer into v_verification_ready
  from domain.contractor_companies cc
  where exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'LICENSE_OR_PERMIT' and cv.status = 'VERIFIED')
    and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'INSURANCE' and cv.status = 'VERIFIED');
  select pg_catalog.count(*)::integer into v_dispatch_ready
  from domain.contractor_companies cc
  where cc.status = 'APPROVED'
    and exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = cc.id and cu.active)
    and exists (select 1 from domain.contractor_service_regions csr where csr.contractor_company_id = cc.id)
    and exists (select 1 from domain.contractor_availability ca where ca.contractor_company_id = cc.id and ca.max_jobs > 0)
    and exists (select 1 from domain.contractor_price_books cpb where cpb.contractor_company_id = cc.id and cpb.active);
  select pg_catalog.count(*)::integer into v_payment_ready
  from domain.contractor_companies cc
  where cc.status = 'APPROVED'
    and internal.contractor_test_payment_ready(cc.id)
    and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'LICENSE_OR_PERMIT' and cv.status = 'VERIFIED')
    and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'INSURANCE' and cv.status = 'VERIFIED')
    and exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = cc.id and cu.active)
    and exists (select 1 from domain.contractor_service_regions csr where csr.contractor_company_id = cc.id)
    and exists (select 1 from domain.contractor_availability ca where ca.contractor_company_id = cc.id and ca.max_jobs > 0)
    and exists (select 1 from domain.contractor_price_books cpb where cpb.contractor_company_id = cc.id and cpb.active);
  select pg_catalog.count(*)::integer into v_region_count from domain.service_regions sr where sr.active;
  select pg_catalog.count(*)::integer into v_regional_rule_count
  from domain.regional_price_books rpb
  join domain.regional_price_rules rpr on rpr.price_book_id = rpb.id
  where rpb.active;
  select exists(select 1 from domain.marketplace_settings ms where ms.active) into v_marketplace_settings_ready;
  return pg_catalog.jsonb_build_object(
    'bookingExecutionEnabled', v_control.booking_execution_enabled,
    'paymentExecutionEnabled', v_control.payment_execution_enabled,
    'allowedPaymentMode', v_control.allowed_payment_mode,
    'maxCustomerTotalCents', v_control.max_customer_total_cents,
    'contractorCount', v_total,
    'approvedContractorCount', v_approved,
    'verificationReadyContractorCount', v_verification_ready,
    'dispatchReadyContractorCount', v_dispatch_ready,
    'paymentReadyContractorCount', v_payment_ready,
    'activeServiceRegionCount', v_region_count,
    'activeRegionalPriceRuleCount', v_regional_rule_count,
    'marketplaceSettingsConfigured', v_marketplace_settings_ready,
    'readyForDispatchDryRun', (v_dispatch_ready > 0 and v_region_count > 0 and v_regional_rule_count > 0 and v_marketplace_settings_ready),
    'readyForTestPayments', (v_control.booking_execution_enabled and v_control.payment_execution_enabled and v_control.allowed_payment_mode = 'STRIPE_TEST' and v_payment_ready > 0 and v_region_count > 0 and v_regional_rule_count > 0 and v_marketplace_settings_ready)
  );
end
$function$;

create or replace function api.admin_set_contractor_status(
  p_contractor_company_id uuid,
  p_status domain.contractor_status,
  p_reason text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_status not in ('APPROVED','DISABLED') or pg_catalog.length(coalesce(p_reason, '')) < 10 or pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACTOR_STATUS_COMMAND';
  end if;
  if p_status = 'APPROVED' and not exists (
    select 1 from domain.contractor_companies cc
    where cc.id = p_contractor_company_id
      and internal.contractor_test_payment_ready(cc.id)
      and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'LICENSE_OR_PERMIT' and cv.status = 'VERIFIED')
      and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.verification_type = 'INSURANCE' and cv.status = 'VERIFIED')
      and exists (select 1 from domain.contractor_service_regions csr where csr.contractor_company_id = cc.id)
      and exists (select 1 from domain.contractor_availability ca where ca.contractor_company_id = cc.id and ca.max_jobs > 0)
      and exists (select 1 from domain.contractor_price_books cpb where cpb.contractor_company_id = cc.id and cpb.active)
  ) then
    raise exception using errcode = 'P0001', message = 'CONTRACTOR_APPROVAL_PRECONDITIONS_FAILED';
  end if;
  update domain.contractor_companies set status = p_status, updated_at = pg_catalog.now() where id = p_contractor_company_id;
  if not found then raise exception using errcode = 'P0002', message = 'CONTRACTOR_NOT_FOUND'; end if;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'CONTRACTOR_STATUS_CHANGED', 'contractor_company', p_contractor_company_id, p_reason,
    pg_catalog.jsonb_build_object('status', p_status, 'idempotencyKey', p_idempotency_key));
end
$function$;

create or replace function api.admin_set_pilot_controls(
  p_booking_execution_enabled boolean,
  p_payment_execution_enabled boolean,
  p_max_customer_total_cents integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_readiness jsonb;
  v_control domain.pilot_controls%rowtype;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_payment_execution_enabled and not p_booking_execution_enabled then
    raise exception using errcode = '22023', message = 'PAYMENT_REQUIRES_BOOKING_EXECUTION';
  end if;
  if p_max_customer_total_cents not between 100 and 1000000 or pg_catalog.length(coalesce(p_reason, '')) < 10 or pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'INVALID_PILOT_CONTROL_COMMAND';
  end if;
  if exists (select 1 from domain.audit_records ar where ar.action = 'PILOT_CONTROLS_CHANGED' and ar.metadata ->> 'idempotencyKey' = p_idempotency_key) then
    select * into strict v_control from domain.pilot_controls pc where pc.id = 1;
    return pg_catalog.jsonb_build_object('bookingExecutionEnabled', v_control.booking_execution_enabled, 'paymentExecutionEnabled', v_control.payment_execution_enabled, 'allowedPaymentMode', v_control.allowed_payment_mode, 'maxCustomerTotalCents', v_control.max_customer_total_cents, 'duplicate', true);
  end if;
  if p_booking_execution_enabled then
    v_readiness := api.pilot_readiness();
    if coalesce((v_readiness ->> 'paymentReadyContractorCount')::integer, 0) < 1
       or coalesce((v_readiness ->> 'activeServiceRegionCount')::integer, 0) < 1
       or coalesce((v_readiness ->> 'activeRegionalPriceRuleCount')::integer, 0) < 1
       or coalesce((v_readiness ->> 'marketplaceSettingsConfigured')::boolean, false) is not true then
      raise exception using errcode = 'P0001', message = 'PILOT_READINESS_PRECONDITIONS_FAILED';
    end if;
  end if;
  update domain.pilot_controls
  set booking_execution_enabled = p_booking_execution_enabled,
      payment_execution_enabled = p_payment_execution_enabled,
      allowed_payment_mode = case when p_booking_execution_enabled or p_payment_execution_enabled then 'STRIPE_TEST' else 'FAKE' end,
      max_customer_total_cents = p_max_customer_total_cents,
      updated_at = pg_catalog.now()
  where id = 1
  returning * into v_control;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'PILOT_CONTROLS_CHANGED', 'pilot_controls', null, p_reason,
    pg_catalog.jsonb_build_object('idempotencyKey', p_idempotency_key, 'bookingExecutionEnabled', p_booking_execution_enabled, 'paymentExecutionEnabled', p_payment_execution_enabled, 'allowedPaymentMode', v_control.allowed_payment_mode, 'maxCustomerTotalCents', p_max_customer_total_cents));
  return pg_catalog.jsonb_build_object('bookingExecutionEnabled', v_control.booking_execution_enabled, 'paymentExecutionEnabled', v_control.payment_execution_enabled, 'allowedPaymentMode', v_control.allowed_payment_mode, 'maxCustomerTotalCents', v_control.max_customer_total_cents);
end
$function$;

do $patch$
declare v_sql text; v_before text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname = 'contractor_onboarding_get' and p.prokind = 'f';
  v_before := v_sql;
  v_sql := pg_catalog.replace(v_sql,
    '''stripeReady'', (v_company.stripe_details_submitted and v_company.stripe_charges_enabled and v_company.stripe_payouts_enabled)',
    '''stripeReady'', internal.contractor_test_payment_ready(v_company.id), ''stripeConnectEnvironment'', v_company.stripe_connect_environment, ''stripeTransferCapabilityStatus'', v_company.stripe_transfer_capability_status');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:contractor_onboarding_get'; end if;
  execute v_sql;
end
$patch$;

do $patch$
declare v_name text; v_sql text; v_before text;
begin
  foreach v_name in array array['create_quote','create_booking'] loop
    select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = v_name and p.prokind = 'f';
    v_before := v_sql;
    v_sql := pg_catalog.regexp_replace(v_sql,
      'cc\.status = ''APPROVED'' and cc\.stripe_connected_account_id is not null[[:space:]]+and cc\.stripe_details_submitted and cc\.stripe_charges_enabled and cc\.stripe_payouts_enabled',
      'cc.status = ''APPROVED'' and internal.contractor_test_payment_ready(cc.id)');
    if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:%', v_name; end if;
    if v_name = 'create_booking' then
      v_before := v_sql;
      v_sql := pg_catalog.replace(v_sql,
        'if not exists (
    select 1 from internal.verified_setup_intents',
        'perform internal.assert_pilot_booking_execution(v_quote.customer_total_cents);
  if not exists (
    select 1 from internal.verified_setup_intents');
      if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:create_booking_pilot_gate'; end if;
    end if;
    execute v_sql;
  end loop;
end
$patch$;

do $patch$
declare v_sql text; v_before text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname = 'accept_order_offer' and p.prokind = 'f';
  v_before := v_sql;
  v_sql := pg_catalog.regexp_replace(v_sql,
    'v_company\.status <> ''APPROVED'' or not v_company\.stripe_details_submitted or not v_company\.stripe_charges_enabled or not v_company\.stripe_payouts_enabled or v_company\.stripe_connected_account_id is null',
    'v_company.status <> ''APPROVED'' or not internal.contractor_test_payment_ready(v_company.id)');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:accept_order_offer_connect'; end if;
  v_before := v_sql;
  v_sql := pg_catalog.replace(v_sql,
    'select * into strict v_company from domain.contractor_companies cc where cc.id = v_offer.contractor_company_id;',
    'perform internal.assert_pilot_payment_execution();
  select * into strict v_company from domain.contractor_companies cc where cc.id = v_offer.contractor_company_id;');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:accept_order_offer_pilot_gate'; end if;
  execute v_sql;
end
$patch$;

do $patch$
declare v_sql text; v_before text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'finalize_reassignment' and p.prokind = 'f';
  v_before := v_sql;
  v_sql := pg_catalog.regexp_replace(v_sql,
    'v_company\.status <> ''APPROVED'' or not v_company\.stripe_details_submitted or not v_company\.stripe_charges_enabled or not v_company\.stripe_payouts_enabled or v_company\.stripe_connected_account_id is null',
    'v_company.status <> ''APPROVED'' or not internal.contractor_test_payment_ready(v_company.id)');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:finalize_reassignment_connect'; end if;
  v_before := v_sql;
  v_sql := pg_catalog.replace(v_sql,
    'select * into strict v_company from domain.contractor_companies cc where cc.id = v_order.pending_contractor_company_id;',
    'perform internal.assert_pilot_payment_execution();
  select * into strict v_company from domain.contractor_companies cc where cc.id = v_order.pending_contractor_company_id;');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:finalize_reassignment_pilot_gate'; end if;
  execute v_sql;
end
$patch$;

do $patch$
declare v_sql text; v_before text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'begin_authorization' and p.prokind = 'f';
  v_before := v_sql;
  v_sql := pg_catalog.replace(v_sql,
    'update domain.payment_generations
    set status = ''AUTHORIZATION_PENDING'', updated_at = pg_catalog.now()',
    'perform internal.assert_pilot_payment_execution();
  if not exists (
    select 1
    from domain.order_assignments oa
    join domain.contractor_companies cc on cc.id = oa.contractor_company_id
    where oa.id = v_generation.assignment_id
      and oa.released_at is null
      and cc.status = ''APPROVED''
      and cc.stripe_connected_account_id = v_generation.connected_account_id
      and internal.contractor_test_payment_ready(cc.id)
  ) then
    raise exception using errcode = ''P0001'', message = ''CONTRACTOR_CONNECT_NOT_READY'';
  end if;
  update domain.payment_generations
    set status = ''AUTHORIZATION_PENDING'', updated_at = pg_catalog.now()');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:begin_authorization'; end if;
  execute v_sql;
end
$patch$;

do $patch$
declare v_sql text; v_before text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into strict v_sql
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'get_payment_operation_context' and p.prokind = 'f';
  v_before := v_sql;
  v_sql := pg_catalog.replace(v_sql,
    '''providerPaymentIntentId'', pg.provider_payment_intent_id',
    '''providerPaymentIntentId'', pg.provider_payment_intent_id,
    ''contractorConnectReady'', internal.contractor_test_payment_ready(oa.contractor_company_id)');
  if v_sql = v_before then raise exception 'STAGE5_PATCH_FAILED:get_payment_operation_context'; end if;
  execute v_sql;
end
$patch$;

grant update on table domain.pilot_controls to drainly_routine_owner;

grant create on schema api, internal to drainly_routine_owner;
alter function internal.contractor_test_payment_ready(uuid) owner to drainly_routine_owner;
alter function internal.assert_pilot_booking_execution(integer) owner to drainly_routine_owner;
alter function internal.assert_pilot_payment_execution() owner to drainly_routine_owner;
alter function internal.marketplace_ranked_candidates(uuid, domain.tank_tier, domain.timing_kind, date) owner to drainly_routine_owner;
alter function api.admin_set_pilot_controls(boolean, boolean, integer, text, text) owner to drainly_routine_owner;
revoke create on schema api, internal from drainly_routine_owner;

revoke all on function internal.contractor_test_payment_ready(uuid) from public, anon, authenticated;
revoke all on function internal.assert_pilot_booking_execution(integer) from public, anon, authenticated;
revoke all on function internal.assert_pilot_payment_execution() from public, anon, authenticated;
revoke all on function internal.marketplace_ranked_candidates(uuid, domain.tank_tier, domain.timing_kind, date) from public, anon, authenticated;
revoke all on function api.admin_set_pilot_controls(boolean, boolean, integer, text, text) from public, anon;

grant execute on function internal.assert_pilot_payment_execution() to drainly_system;
grant execute on function api.pilot_readiness() to drainly_system;
grant execute on function api.admin_set_pilot_controls(boolean, boolean, integer, text, text) to authenticated;

commit;
