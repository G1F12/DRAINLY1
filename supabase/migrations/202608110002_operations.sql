begin;

create or replace function api.ensure_customer_profile(p_phone text default null) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare v_customer_id uuid;
begin
  if identity.uid() is null or coalesce(identity.jwt() ->> 'email', '') = '' then
    raise exception using errcode = '42501', message = 'VERIFIED_EMAIL_REQUIRED';
  end if;
  insert into domain.customers(auth_user_id, email, phone)
  values (identity.uid(), identity.jwt() ->> 'email', p_phone)
  on conflict (auth_user_id) do update set phone = coalesce(excluded.phone, domain.customers.phone), updated_at = pg_catalog.now()
  returning id into v_customer_id;
  return v_customer_id;
end
$function$;

create or replace function api.decline_order_offer(p_offer_id uuid, p_idempotency_key text) returns void
language plpgsql security definer set search_path = ''
as $function$
declare v_offer domain.order_offers%rowtype;
begin
  select * into v_offer from domain.order_offers oo where oo.id = p_offer_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'OFFER_NOT_FOUND'; end if;
  if not exists (select 1 from domain.contractor_users cu where cu.auth_user_id = identity.uid() and cu.contractor_company_id = v_offer.contractor_company_id and cu.active) then
    raise exception using errcode = '42501', message = 'OFFER_NOT_OWNED';
  end if;
  if v_offer.status <> 'OPEN' then raise exception using errcode = 'P0001', message = 'OFFER_NOT_OPEN'; end if;
  update domain.order_offers set status = 'DECLINED', responded_at = pg_catalog.now() where id = p_offer_id;
  insert into domain.order_events(order_id, event_type, actor_type, actor_user_id, idempotency_key, metadata)
  values (v_offer.order_id, 'OFFER_DECLINED', 'CONTRACTOR', identity.uid(), p_idempotency_key, pg_catalog.jsonb_build_object('offerId', p_offer_id));
end
$function$;

create or replace function internal.consume_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_allowed boolean;
begin
  if pg_catalog.length(p_bucket_key) <> 64 or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_REQUEST';
  end if;
  insert into internal.rate_limit_buckets(bucket_key, window_started_at, request_count)
  values (p_bucket_key, pg_catalog.now(), 1)
  on conflict (bucket_key) do update set
    window_started_at = case when internal.rate_limit_buckets.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= pg_catalog.now()
      then pg_catalog.now() else internal.rate_limit_buckets.window_started_at end,
    request_count = case when internal.rate_limit_buckets.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= pg_catalog.now()
      then 1 else internal.rate_limit_buckets.request_count + 1 end,
    updated_at = pg_catalog.now()
  returning request_count <= p_limit into v_allowed;
  return v_allowed;
end
$function$;

create or replace function internal.get_payment_operation_context(p_payment_generation_id uuid) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'paymentGenerationId', pg.id, 'orderId', o.id, 'assignmentId', pg.assignment_id,
    'isCurrent', pg.is_current, 'status', pg.status, 'connectedAccountId', pg.connected_account_id,
    'contractorPriceBookVersion', pg.contractor_price_book_version,
    'marketplaceSettingsVersion', pg.marketplace_settings_version,
    'estimatedProcessingRateBps', pg.estimated_processing_rate_bps,
    'estimatedProcessingFixedCents', pg.estimated_processing_fixed_cents,
    'minimumContributionMarginCentsApplied', pg.minimum_contribution_margin_cents_applied,
    'customerTotalCents', pg.customer_total_cents, 'contractorGrossCents', pg.contractor_gross_cents,
    'contractorMarketplaceFeeCents', pg.contractor_marketplace_fee_cents,
    'contractorPayoutCents', pg.contractor_payout_cents, 'stripeTransferAmountCents', pg.stripe_transfer_amount_cents,
    'platformGrossRetainedCents', pg.platform_gross_retained_cents,
    'platformPricingAdjustmentCents', pg.platform_pricing_adjustment_cents,
    'estimatedPaymentProcessingCostCents', pg.estimated_payment_processing_cost_cents,
    'expectedPlatformNetContributionCents', pg.expected_platform_net_contribution_cents,
    'stripeCustomerId', o.stripe_customer_id, 'paymentMethodId', o.stripe_payment_method_id,
    'providerPaymentIntentId', pg.provider_payment_intent_id
  ) into v_context
  from domain.payment_generations pg
  join domain.orders o on o.id = pg.order_id
  join domain.order_assignments oa on oa.id = pg.assignment_id
  where pg.id = p_payment_generation_id;
  if v_context is null then raise exception using errcode = 'P0002', message = 'CURRENT_PAYMENT_CONTEXT_NOT_FOUND'; end if;
  return v_context;
end
$function$;

-- Atomically claims authorization before the provider boundary. A stale task
-- returns shouldRun=false, so it can never create an intent for a superseded
-- contractor. If reassignment overlaps an in-flight provider request, the
-- generation remains current only long enough to persist and cancel that intent.
create or replace function internal.begin_authorization(p_payment_generation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_generation domain.payment_generations%rowtype;
  v_order_status domain.order_status;
  v_order_id uuid;
  v_context jsonb;
begin
  select pg.order_id into v_order_id from domain.payment_generations pg where pg.id = p_payment_generation_id;
  if v_order_id is null then return pg_catalog.jsonb_build_object('shouldRun', false); end if;
  select o.status into v_order_status from domain.orders o where o.id = v_order_id for update;
  select * into v_generation from domain.payment_generations pg where pg.id = p_payment_generation_id for update;
  if not found or not v_generation.is_current
     or v_generation.status not in ('REQUESTED','AUTHORIZATION_SCHEDULED','AUTHORIZATION_PENDING','ACTION_REQUIRED')
     or v_order_status not in ('SCHEDULED','REASSIGNMENT_PENDING') then
    return pg_catalog.jsonb_build_object('shouldRun', false);
  end if;
  if v_order_status = 'REASSIGNMENT_PENDING' and v_generation.status <> 'AUTHORIZATION_PENDING' then
    return pg_catalog.jsonb_build_object('shouldRun', false);
  end if;
  update domain.payment_generations
    set status = 'AUTHORIZATION_PENDING', updated_at = pg_catalog.now()
    where id = p_payment_generation_id;
  v_context := internal.get_payment_operation_context(p_payment_generation_id);
  return v_context || pg_catalog.jsonb_build_object('shouldRun', true);
end
$function$;

create or replace function internal.finalize_reassignment(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order domain.orders%rowtype;
  v_company domain.contractor_companies%rowtype;
  v_current_price record;
  v_settings domain.marketplace_settings%rowtype;
  v_assignment_id uuid;
  v_generation_id uuid;
  v_generation_number integer;
  v_auth_target timestamptz;
  v_status domain.payment_generation_status;
  v_max_jobs integer;
  v_assigned_jobs integer;
  v_marketplace_fee integer;
  v_payout integer;
  v_estimated_fee integer;
  v_net integer;
  v_min_margin integer;
begin
  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found or v_order.status <> 'REASSIGNMENT_PENDING' or v_order.pending_contractor_company_id is null then
    raise exception using errcode = 'P0001', message = 'REASSIGNMENT_NOT_PENDING';
  end if;
  if exists (select 1 from domain.payment_generations pg where pg.order_id = v_order.id and pg.is_current and pg.status not in ('CANCELLED', 'SUPERSEDED')) then
    raise exception using errcode = 'P0001', message = 'OLD_PAYMENT_GENERATION_NOT_RELEASED';
  end if;
  select * into strict v_company from domain.contractor_companies cc where cc.id = v_order.pending_contractor_company_id;
  if v_company.status <> 'APPROVED' or not v_company.stripe_details_submitted or not v_company.stripe_charges_enabled or not v_company.stripe_payouts_enabled or v_company.stripe_connected_account_id is null then
    raise exception using errcode = 'P0001', message = 'REPLACEMENT_CONTRACTOR_INELIGIBLE';
  end if;
  select * into strict v_settings from domain.marketplace_settings ms where ms.active;
  select cpb.version as contractor_price_book_version, cpr.contractor_gross_cents,
    coalesce(cfc.fee_bps, v_settings.default_contractor_fee_bps) as fee_bps,
    coalesce(cfc.fixed_fee_cents, v_settings.default_contractor_fixed_fee_cents) as fixed_fee_cents,
    ca.max_jobs
  into v_current_price
  from domain.quotes q
  join domain.contractor_service_regions csr on csr.contractor_company_id = v_company.id and csr.service_region_id = q.service_region_id
  join domain.contractor_availability ca on ca.contractor_company_id = v_company.id
    and ca.iso_weekday = extract(isodow from v_order.requested_service_date)::integer
  join domain.contractor_price_books cpb on cpb.contractor_company_id = v_company.id and cpb.active
  join domain.contractor_price_rules cpr on cpr.price_book_id = cpb.id and cpr.tank_tier = v_order.tank_tier
    and cpr.timing_kind = v_order.timing_kind and (cpr.service_region_id is null or cpr.service_region_id = q.service_region_id)
  left join domain.contractor_fee_configs cfc on cfc.contractor_company_id = v_company.id
  where q.id = v_order.quote_id and ca.max_jobs > 0 and (v_order.timing_kind <> 'URGENT' or ca.urgent_enabled)
    and not exists (select 1 from domain.contractor_blackout_dates cbd
      where cbd.contractor_company_id = v_company.id and cbd.blackout_date = v_order.requested_service_date);
  if not found then raise exception using errcode = 'P0001', message = 'REPLACEMENT_PRICING_COVERAGE_OR_AVAILABILITY_UNAVAILABLE'; end if;
  v_max_jobs := v_current_price.max_jobs;
  insert into domain.contractor_day_capacity(contractor_company_id, service_date, max_jobs_snapshot)
    values (v_company.id, v_order.requested_service_date, v_max_jobs)
    on conflict (contractor_company_id, service_date) do nothing;
  perform 1 from domain.contractor_day_capacity cdc
    where cdc.contractor_company_id = v_company.id and cdc.service_date = v_order.requested_service_date for update;
  select pg_catalog.count(*) into v_assigned_jobs from domain.order_assignments oa join domain.orders o2 on o2.id = oa.order_id
    where oa.contractor_company_id = v_company.id and oa.released_at is null and o2.requested_service_date = v_order.requested_service_date;
  if v_assigned_jobs >= v_max_jobs then raise exception using errcode = 'P0001', message = 'REPLACEMENT_CAPACITY_EXHAUSTED'; end if;
  v_marketplace_fee := least(v_current_price.contractor_gross_cents,
    ((v_current_price.contractor_gross_cents * v_current_price.fee_bps + 5000) / 10000) + v_current_price.fixed_fee_cents);
  v_payout := v_current_price.contractor_gross_cents - v_marketplace_fee;
  v_estimated_fee := ((v_order.customer_total_cents * v_settings.estimated_processing_rate_bps + 9999) / 10000)
    + v_settings.estimated_processing_fixed_cents;
  v_net := v_order.customer_total_cents - v_payout - v_estimated_fee;
  select coalesce((select qeo.minimum_contribution_margin_cents from domain.quote_economics_overrides qeo where qeo.quote_id = v_order.quote_id),
    v_settings.minimum_contribution_margin_cents) into v_min_margin;
  if v_payout > v_order.customer_total_cents then
    raise exception using errcode = '23514', message = 'REPLACEMENT_PAYOUT_NOT_FUNDED';
  end if;
  if v_net < v_min_margin then
    raise exception using errcode = 'P0001', message = 'REPLACEMENT_CONTRIBUTION_GUARDRAIL_FAILED';
  end if;
  insert into domain.order_assignments(order_id, contractor_company_id)
    values (v_order.id, v_company.id) returning id into v_assignment_id;
  select coalesce(pg_catalog.max(pg.generation_number), 0) + 1 into v_generation_number
    from domain.payment_generations pg where pg.order_id = v_order.id;
  v_auth_target := v_order.service_window_start_at - pg_catalog.make_interval(mins => v_settings.authorization_lead_time_minutes);
  v_status := case when v_order.timing_kind = 'URGENT' or v_auth_target <= pg_catalog.now() then 'REQUESTED'::domain.payment_generation_status else 'AUTHORIZATION_SCHEDULED'::domain.payment_generation_status end;
  insert into domain.payment_generations(order_id, assignment_id, generation_number, status, connected_account_id,
    contractor_price_book_version, marketplace_settings_version, estimated_processing_rate_bps,
    estimated_processing_fixed_cents, minimum_contribution_margin_cents_applied,
    customer_total_cents, contractor_gross_cents, contractor_marketplace_fee_cents, contractor_payout_cents,
    stripe_transfer_amount_cents, platform_gross_retained_cents, platform_pricing_adjustment_cents,
    estimated_payment_processing_cost_cents, expected_platform_net_contribution_cents, authorization_target_at,
    predecessor_generation_id)
  values (v_order.id, v_assignment_id, v_generation_number, v_status, v_company.stripe_connected_account_id,
    v_current_price.contractor_price_book_version, v_settings.version, v_settings.estimated_processing_rate_bps,
    v_settings.estimated_processing_fixed_cents, v_min_margin,
    v_order.customer_total_cents, v_current_price.contractor_gross_cents, v_marketplace_fee,
    v_payout, v_payout,
    v_order.customer_total_cents - v_payout, v_order.customer_subtotal_cents - v_current_price.contractor_gross_cents,
    v_estimated_fee, v_net,
    v_auth_target, (select pg.id from domain.payment_generations pg where pg.order_id = v_order.id order by pg.generation_number desc limit 1))
  returning id into v_generation_id;
  update domain.orders set status = 'SCHEDULED', pending_contractor_company_id = null, version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
  insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
  values ('AUTHORIZE_PAYMENT', 'payment_generation', v_generation_id, greatest(v_auth_target, pg_catalog.now()),
    'authorize:' || v_generation_id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation_id));
  return pg_catalog.jsonb_build_object('assignmentId', v_assignment_id, 'paymentGenerationId', v_generation_id);
end
$function$;

create or replace function api.reassign_order(p_order_id uuid, p_replacement_contractor_company_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order domain.orders%rowtype;
  v_assignment domain.order_assignments%rowtype;
  v_generation domain.payment_generations%rowtype;
  v_result jsonb;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if pg_catalog.length(coalesce(p_reason, '')) < 10 then raise exception using errcode = '22023', message = 'REASSIGNMENT_REASON_REQUIRED'; end if;
  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found or v_order.status not in ('SCHEDULED', 'SEARCHING_CONTRACTOR') then raise exception using errcode = 'P0001', message = 'ORDER_NOT_REASSIGNABLE'; end if;
  select * into v_assignment from domain.order_assignments oa where oa.order_id = v_order.id and oa.released_at is null for update;
  if found and v_assignment.contractor_company_id = p_replacement_contractor_company_id then raise exception using errcode = '22023', message = 'REPLACEMENT_MUST_DIFFER'; end if;
  select * into v_generation from domain.payment_generations pg where pg.order_id = v_order.id and pg.is_current for update;
  if found and v_generation.status = 'CAPTURED' then raise exception using errcode = 'P0001', message = 'CAPTURED_PAYMENT_REQUIRES_MANUAL_RECOVERY'; end if;
  if v_assignment.id is not null then
    update domain.order_assignments set released_at = pg_catalog.now(), release_reason = p_reason where id = v_assignment.id;
  end if;
  update domain.orders set status = 'REASSIGNMENT_PENDING', pending_contractor_company_id = p_replacement_contractor_company_id,
    version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
  if v_generation.id is not null and v_generation.provider_payment_intent_id is null
     and v_generation.status = 'AUTHORIZATION_PENDING' then
    -- The provider call may already be in flight. Keep this generation current
    -- until its deterministic result is recorded, then cancel it before the
    -- replacement generation is created.
    v_result := pg_catalog.jsonb_build_object('authorizationPending', true, 'oldPaymentGenerationId', v_generation.id);
  elsif v_generation.id is null or v_generation.provider_payment_intent_id is null then
    if v_generation.id is not null then update domain.payment_generations set is_current = false, status = 'SUPERSEDED', updated_at = pg_catalog.now() where id = v_generation.id; end if;
    v_result := internal.finalize_reassignment(v_order.id);
  else
    update domain.payment_generations set status = 'CANCELLATION_PENDING', updated_at = pg_catalog.now() where id = v_generation.id;
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
    values ('CANCEL_AUTHORIZATION', 'payment_generation', v_generation.id, pg_catalog.now(), 'cancel:' || v_generation.id::text,
      pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id, 'orderId', v_order.id));
    v_result := pg_catalog.jsonb_build_object('cancellationPending', true, 'oldPaymentGenerationId', v_generation.id);
  end if;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'ORDER_REASSIGNED', 'order', v_order.id, p_reason,
    pg_catalog.jsonb_build_object('replacementContractorCompanyId', p_replacement_contractor_company_id, 'idempotencyKey', p_idempotency_key));
  insert into domain.order_events(order_id, event_type, actor_type, actor_user_id, idempotency_key, metadata)
  values (v_order.id, 'REASSIGNMENT_REQUESTED', 'ADMIN', identity.uid(), p_idempotency_key,
    pg_catalog.jsonb_build_object('replacementContractorCompanyId', p_replacement_contractor_company_id));
  return v_result;
end
$function$;

create or replace function internal.record_cancellation_and_finalize(p_payment_generation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order_id uuid;
begin
  update domain.payment_generations pg set status = 'SUPERSEDED', is_current = false, updated_at = pg_catalog.now()
    from domain.orders o
    where pg.id = p_payment_generation_id and pg.order_id = o.id and o.status = 'REASSIGNMENT_PENDING'
      and pg.status in ('CANCELLATION_PENDING','CANCELLED') returning pg.order_id into v_order_id;
  if v_order_id is null then raise exception using errcode = 'P0001', message = 'PAYMENT_GENERATION_NOT_CANCELLATION_PENDING'; end if;
  return internal.finalize_reassignment(v_order_id);
end
$function$;

create or replace function api.request_refund(p_order_id uuid, p_amount_cents integer, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_generation domain.payment_generations%rowtype;
  v_refunded integer;
  v_refund_id uuid;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_amount_cents <= 0 or pg_catalog.length(coalesce(p_reason, '')) < 5 then raise exception using errcode = '22023', message = 'INVALID_REFUND_REQUEST'; end if;
  select * into v_generation from domain.payment_generations pg where pg.order_id = p_order_id and pg.is_current and pg.status = 'CAPTURED' for update;
  if not found then raise exception using errcode = 'P0001', message = 'CAPTURED_PAYMENT_REQUIRED'; end if;
  select coalesce(pg_catalog.sum(r.amount_cents) filter (where r.status in ('REQUESTED','PENDING','SUCCEEDED')), 0) into v_refunded
    from domain.refunds r where r.payment_generation_id = v_generation.id;
  if p_amount_cents > v_generation.customer_total_cents - v_refunded then raise exception using errcode = '23514', message = 'REFUND_EXCEEDS_REMAINING_AMOUNT'; end if;
  insert into domain.refunds(order_id, payment_generation_id, amount_cents, reason, idempotency_key, created_by)
  values (p_order_id, v_generation.id, p_amount_cents, p_reason, p_idempotency_key, identity.uid()) returning id into v_refund_id;
  insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
  values ('REFUND_PAYMENT', 'refund', v_refund_id, pg_catalog.now(), 'refund:' || v_refund_id::text, pg_catalog.jsonb_build_object('refundId', v_refund_id));
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'REFUND_REQUESTED', 'order', p_order_id, p_reason, pg_catalog.jsonb_build_object('refundId', v_refund_id, 'amountCents', p_amount_cents));
  return pg_catalog.jsonb_build_object('refundId', v_refund_id, 'status', 'REQUESTED');
end
$function$;

create or replace function internal.get_refund_context(p_refund_id uuid) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare v_context jsonb;
begin
  select pg_catalog.jsonb_build_object('refundId', r.id, 'orderId', r.order_id, 'paymentGenerationId', r.payment_generation_id, 'amountCents', r.amount_cents,
    'reason', r.reason, 'idempotencyKey', r.idempotency_key, 'providerPaymentIntentId', pg.provider_payment_intent_id,
    'customerTotalCents', pg.customer_total_cents, 'stripeTransferAmountCents', pg.stripe_transfer_amount_cents)
  into v_context from domain.refunds r join domain.payment_generations pg on pg.id = r.payment_generation_id where r.id = p_refund_id and r.status = 'REQUESTED';
  if v_context is null then raise exception using errcode = 'P0002', message = 'REFUND_CONTEXT_NOT_FOUND'; end if;
  return v_context;
end
$function$;

create or replace function internal.record_refund_result(p_refund_id uuid, p_provider_refund_id text, p_status domain.refund_status,
  p_transfer_reversal_cents integer default null, p_failure_message text default null) returns void
language plpgsql security definer set search_path = ''
as $function$
declare v_refund domain.refunds%rowtype; v_expected_reversal integer; v_unrecovered integer; v_actual_net integer;
begin
  select ((pg.stripe_transfer_amount_cents::bigint * r.amount_cents) / pg.customer_total_cents)::integer into v_expected_reversal
    from domain.refunds r join domain.payment_generations pg on pg.id = r.payment_generation_id where r.id = p_refund_id;
  v_unrecovered := case when p_status = 'SUCCEEDED' then greatest(v_expected_reversal - coalesce(p_transfer_reversal_cents, 0), 0) else null end;
  update domain.refunds set provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id), status = p_status,
    transfer_reversal_cents = p_transfer_reversal_cents, unrecovered_contractor_funds_cents = v_unrecovered,
    failure_message = pg_catalog.left(p_failure_message, 1000), updated_at = pg_catalog.now()
  where id = p_refund_id and status in ('REQUESTED','PENDING') returning * into v_refund;
  if not found then raise exception using errcode = 'P0001', message = 'REFUND_NOT_PENDING'; end if;
  if p_status = 'SUCCEEDED' then
    insert into domain.financial_ledger_entries(order_id, payment_generation_id, refund_id, entry_type, amount_cents, provider_reference, occurred_at)
      values (v_refund.order_id, v_refund.payment_generation_id, v_refund.id, 'CUSTOMER_REFUND', v_refund.amount_cents, p_provider_refund_id, pg_catalog.now());
    if p_transfer_reversal_cents is not null then
      insert into domain.financial_ledger_entries(order_id, payment_generation_id, refund_id, entry_type, amount_cents, provider_reference, occurred_at)
        values (v_refund.order_id, v_refund.payment_generation_id, v_refund.id, 'TRANSFER_REVERSAL', p_transfer_reversal_cents, p_provider_refund_id || ':transfer_reversal', pg_catalog.now());
    end if;
    select coalesce(pg_catalog.sum(case fle.entry_type
      when 'CAPTURE' then fle.amount_cents
      when 'TRANSFER_REVERSAL' then fle.amount_cents
      else -fle.amount_cents end), 0)::integer into v_actual_net
    from domain.financial_ledger_entries fle where fle.payment_generation_id = v_refund.payment_generation_id;
    update domain.payment_generations set actual_platform_net_transaction_cents = v_actual_net, updated_at = pg_catalog.now()
      where id = v_refund.payment_generation_id;
  end if;
end
$function$;

create or replace function internal.verify_job_proof(p_proof_id uuid, p_succeeded boolean, p_failure_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $function$
declare v_status domain.proof_status;
begin
  select jp.status into v_status from domain.job_proofs jp where jp.id = p_proof_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROOF_NOT_FOUND'; end if;
  if (p_succeeded and v_status = 'VERIFIED') or (not p_succeeded and v_status = 'REJECTED') then return; end if;
  update domain.job_proofs set status = case when p_succeeded then 'VERIFIED'::domain.proof_status else 'REJECTED'::domain.proof_status end,
    verified_at = case when p_succeeded then pg_catalog.now() else null end
  where id = p_proof_id and status = 'PENDING';
  if not found then raise exception using errcode = 'P0001', message = 'PROOF_NOT_PENDING'; end if;
  if not p_succeeded then
    insert into domain.audit_records(actor_type, action, resource_type, resource_id, reason)
    values ('SYSTEM', 'JOB_PROOF_REJECTED', 'job_proof', p_proof_id, pg_catalog.left(p_failure_reason, 500));
  end if;
end
$function$;

create or replace function internal.record_verified_setup_intent(
  p_auth_user_id uuid,
  p_setup_intent_id text,
  p_stripe_customer_id text,
  p_payment_method_id text,
  p_provider_status text,
  p_usage text,
  p_consent_version text,
  p_consent_recorded_at timestamptz
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if p_auth_user_id is null
     or pg_catalog.length(p_setup_intent_id) < 3
     or pg_catalog.length(p_stripe_customer_id) < 3
     or pg_catalog.length(p_payment_method_id) < 3
     or p_provider_status <> 'succeeded'
     or p_usage <> 'off_session'
     or pg_catalog.length(p_consent_version) < 3
     or p_consent_recorded_at is null
     or p_consent_recorded_at > pg_catalog.now() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'INVALID_VERIFIED_SETUP_INTENT';
  end if;
  insert into internal.verified_setup_intents(
    setup_intent_id, auth_user_id, stripe_customer_id, payment_method_id,
    provider_status, usage, consent_version, consent_recorded_at
  ) values (
    p_setup_intent_id, p_auth_user_id, p_stripe_customer_id, p_payment_method_id,
    p_provider_status, p_usage, p_consent_version, p_consent_recorded_at
  ) on conflict (setup_intent_id) do update set
    auth_user_id = excluded.auth_user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    payment_method_id = excluded.payment_method_id,
    provider_status = excluded.provider_status,
    usage = excluded.usage,
    consent_version = excluded.consent_version,
    consent_recorded_at = excluded.consent_recorded_at,
    verified_at = pg_catalog.now()
  where internal.verified_setup_intents.consumed_at is null
    and internal.verified_setup_intents.auth_user_id = excluded.auth_user_id;
  if not found then raise exception using errcode = '23505', message = 'SETUP_INTENT_ALREADY_CONSUMED_OR_OWNED'; end if;
end
$function$;

create or replace function internal.get_proof_verification_context(p_proof_id uuid) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'proofId', jp.id,
    'orderId', jp.order_id,
    'storagePath', jp.storage_path,
    'mimeType', jp.mime_type,
    'sizeBytes', jp.size_bytes,
    'checksumSha256', jp.checksum_sha256,
    'status', jp.status
  ) into v_context
  from domain.job_proofs jp
  where jp.id = p_proof_id and jp.status = 'PENDING';
  if v_context is null then raise exception using errcode = 'P0002', message = 'PENDING_PROOF_NOT_FOUND'; end if;
  return v_context;
end
$function$;

create or replace function api.admin_override_quote_economics(
  p_quote_id uuid,
  p_minimum_contribution_margin_cents integer,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_quote domain.quotes%rowtype; v_viable integer;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_minimum_contribution_margin_cents not between -100000 and 1000000
     or pg_catalog.length(coalesce(p_reason, '')) < 10
     or pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMICS_OVERRIDE';
  end if;
  select * into v_quote from domain.quotes q where q.id = p_quote_id for update;
  if not found or v_quote.status <> 'REVIEW_REQUIRED' or v_quote.expires_at <= pg_catalog.now() or v_quote.customer_total_cents is null then
    raise exception using errcode = 'P0001', message = 'QUOTE_NOT_OVERRIDEABLE';
  end if;
  select pg_catalog.count(*) into v_viable from domain.quote_candidates qc
    where qc.quote_id = v_quote.id
      and qc.contractor_payout_cents <= v_quote.customer_total_cents
      and qc.expected_platform_net_contribution_cents >= p_minimum_contribution_margin_cents;
  if v_viable = 0 then raise exception using errcode = '23514', message = 'PAYOUT_FUNDING_OR_OVERRIDE_GUARDRAIL_FAILED'; end if;
  insert into domain.quote_economics_overrides(quote_id, minimum_contribution_margin_cents, reason, admin_user_id, idempotency_key)
    values (v_quote.id, p_minimum_contribution_margin_cents, p_reason, identity.uid(), p_idempotency_key);
  update domain.quote_candidates set meets_guardrail = contractor_payout_cents <= v_quote.customer_total_cents
    and expected_platform_net_contribution_cents >= p_minimum_contribution_margin_cents where quote_id = v_quote.id;
  update domain.quotes set status = 'PRICED' where id = v_quote.id;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
    values (identity.uid(), 'ADMIN', 'QUOTE_ECONOMICS_OVERRIDE', 'quote', v_quote.id, p_reason,
      pg_catalog.jsonb_build_object('minimumContributionMarginCents', p_minimum_contribution_margin_cents, 'idempotencyKey', p_idempotency_key));
  return pg_catalog.jsonb_build_object('quoteId', v_quote.id, 'status', 'PRICED', 'viableCandidateCount', v_viable);
end
$function$;

create or replace function api.admin_set_contractor_status(
  p_contractor_company_id uuid,
  p_status domain.contractor_status,
  p_reason text,
  p_idempotency_key text
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_status not in ('APPROVED','DISABLED') or pg_catalog.length(coalesce(p_reason, '')) < 10
     or pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'INVALID_CONTRACTOR_STATUS_COMMAND';
  end if;
  if p_status = 'APPROVED' and not exists (
    select 1 from domain.contractor_companies cc
    where cc.id = p_contractor_company_id and cc.stripe_connected_account_id is not null
      and cc.stripe_details_submitted and cc.stripe_charges_enabled and cc.stripe_payouts_enabled
      and exists (select 1 from domain.contractor_verifications cv where cv.contractor_company_id = cc.id and cv.status = 'VERIFIED')
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

create or replace function api.cancel_order(p_order_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order domain.orders%rowtype;
  v_generation domain.payment_generations%rowtype;
  v_actor_type text;
  v_admin boolean;
begin
  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND'; end if;
  v_admin := exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active);
  if exists (select 1 from domain.customers c where c.id = v_order.customer_id and c.auth_user_id = identity.uid()) then
    v_actor_type := 'CUSTOMER';
    if v_order.status not in ('SEARCHING_CONTRACTOR','SCHEDULED') then raise exception using errcode = 'P0001', message = 'CUSTOMER_CANCELLATION_NOT_ALLOWED'; end if;
  elsif v_admin and coalesce(identity.jwt() ->> 'aal', '') = 'aal2'
    and coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb then
    v_actor_type := 'ADMIN';
    if v_order.status in ('CLOSED','CANCELLED') then raise exception using errcode = 'P0001', message = 'ORDER_NOT_CANCELLABLE'; end if;
  else
    raise exception using errcode = '42501', message = 'ORDER_CANCELLATION_NOT_AUTHORIZED';
  end if;
  if pg_catalog.length(coalesce(p_reason, '')) < 5 or pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'CANCELLATION_REASON_AND_IDEMPOTENCY_REQUIRED';
  end if;
  update domain.order_assignments set released_at = pg_catalog.now(), release_reason = p_reason
    where order_id = v_order.id and released_at is null;
  update domain.order_offers set status = 'WITHDRAWN', responded_at = pg_catalog.now()
    where order_id = v_order.id and status = 'OPEN';
  select * into v_generation from domain.payment_generations pg where pg.order_id = v_order.id and pg.is_current for update;
  if found and v_generation.status = 'CAPTURED' then raise exception using errcode = 'P0001', message = 'CAPTURED_PAYMENT_REQUIRES_REFUND'; end if;
  if found and v_generation.provider_payment_intent_id is not null and v_generation.status not in ('CANCELLED','SUPERSEDED') then
    update domain.payment_generations set status = 'CANCELLATION_PENDING', updated_at = pg_catalog.now() where id = v_generation.id;
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
      values ('CANCEL_ORDER_AUTHORIZATION', 'payment_generation', v_generation.id, pg_catalog.now(),
        'cancel-order:' || v_generation.id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id));
  elsif found then
    update domain.payment_generations set status = 'CANCELLED', is_current = false, updated_at = pg_catalog.now() where id = v_generation.id;
  end if;
  update domain.orders set status = 'CANCELLED', version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
  insert into domain.order_events(order_id, event_type, previous_status, resulting_status, actor_type, actor_user_id, idempotency_key, metadata)
    values (v_order.id, 'ORDER_CANCELLED', v_order.status, 'CANCELLED', v_actor_type, identity.uid(), p_idempotency_key,
      pg_catalog.jsonb_build_object('reason', p_reason));
  if v_admin then
    insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
      values (identity.uid(), 'ADMIN', 'ORDER_CANCELLED', 'order', v_order.id, p_reason, pg_catalog.jsonb_build_object('idempotencyKey', p_idempotency_key));
  end if;
  return pg_catalog.jsonb_build_object('orderId', v_order.id, 'status', 'CANCELLED',
    'cancellationPending', v_generation.provider_payment_intent_id is not null);
end
$function$;

create or replace function internal.record_order_cancellation_release(p_payment_generation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update domain.payment_generations pg set status = 'CANCELLED', is_current = false, updated_at = pg_catalog.now()
  from domain.orders o
  where pg.id = p_payment_generation_id and pg.order_id = o.id and o.status = 'CANCELLED'
    and pg.status in ('CANCELLATION_PENDING','CANCELLED');
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CANCELLATION_RELEASE_NOT_APPLICABLE'; end if;
end
$function$;

create or replace function internal.process_dispute_webhook(
  p_provider_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_payload_sha256 text,
  p_provider_dispute_id text,
  p_provider_payment_intent_id text,
  p_amount_cents integer,
  p_provider_status text,
  p_fee_cents integer default 0
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_generation domain.payment_generations%rowtype; v_actual_net integer;
begin
  insert into internal.webhook_events(provider, provider_event_id, event_type, livemode, payload_sha256)
    values ('STRIPE', p_provider_event_id, p_event_type, p_livemode, p_payload_sha256)
    on conflict (provider_event_id) do nothing;
  if not found then return pg_catalog.jsonb_build_object('duplicate', true); end if;
  if p_livemode then
    update internal.webhook_events set status = 'IGNORED', processed_at = pg_catalog.now(), error_message = 'Live events disabled in pilot implementation'
      where provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object('ignored', true);
  end if;
  select * into v_generation from domain.payment_generations pg where pg.provider_payment_intent_id = p_provider_payment_intent_id for update;
  insert into internal.provider_disputes(provider_dispute_id, order_id, payment_generation_id, amount_cents, fee_cents, provider_status)
    values (p_provider_dispute_id, v_generation.order_id, v_generation.id, p_amount_cents, p_fee_cents, p_provider_status)
    on conflict (provider_dispute_id) do update set provider_status = excluded.provider_status,
      fee_cents = excluded.fee_cents, updated_at = pg_catalog.now();
  if v_generation.id is not null and p_fee_cents > 0 then
    insert into domain.financial_ledger_entries(order_id, payment_generation_id, entry_type, amount_cents, provider_reference, provider_event_id, occurred_at)
      values (v_generation.order_id, v_generation.id, 'DISPUTE_FEE', p_fee_cents, p_provider_dispute_id || ':fee', p_provider_event_id, pg_catalog.now())
      on conflict do nothing;
  end if;
  if v_generation.id is not null then
    insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
      values ('payment.dispute_alert', 'order', v_generation.order_id, 'stripe:' || p_provider_event_id || ':alert',
        pg_catalog.jsonb_build_object('orderId', v_generation.order_id, 'providerDisputeId', p_provider_dispute_id, 'amountCents', p_amount_cents))
      on conflict (idempotency_key) do nothing;
    select coalesce(pg_catalog.sum(case fle.entry_type when 'CAPTURE' then fle.amount_cents when 'TRANSFER_REVERSAL' then fle.amount_cents else -fle.amount_cents end), 0)::integer
      into v_actual_net from domain.financial_ledger_entries fle where fle.payment_generation_id = v_generation.id;
    update domain.payment_generations set actual_platform_net_transaction_cents = v_actual_net, updated_at = pg_catalog.now() where id = v_generation.id;
  end if;
  update internal.webhook_events set status = 'PROCESSED', processed_at = pg_catalog.now() where provider_event_id = p_provider_event_id;
  return pg_catalog.jsonb_build_object('processed', true, 'paymentGenerationId', v_generation.id);
end
$function$;

create or replace function internal.begin_payment_attempt(
  p_payment_generation_id uuid,
  p_operation text,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare v_attempt_id uuid;
begin
  if p_operation not in ('AUTHORIZE','CANCEL','CAPTURE','REFUND') or pg_catalog.length(p_idempotency_key) < 8 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_ATTEMPT';
  end if;
  if not exists (select 1 from domain.payment_generations pg where pg.id = p_payment_generation_id) then
    raise exception using errcode = 'P0002', message = 'PAYMENT_GENERATION_NOT_FOUND';
  end if;
  insert into internal.payment_attempts(payment_generation_id, operation, idempotency_key, status)
    values (p_payment_generation_id, p_operation, p_idempotency_key, 'STARTED')
  on conflict (idempotency_key) do update set status = 'STARTED', attempts = internal.payment_attempts.attempts + 1,
    failure_code = null, completed_at = null
  returning id into v_attempt_id;
  return v_attempt_id;
end
$function$;

create or replace function internal.complete_payment_attempt(
  p_attempt_id uuid,
  p_succeeded boolean,
  p_provider_object_id text default null,
  p_failure_code text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update internal.payment_attempts set status = case when p_succeeded then 'SUCCEEDED' else 'FAILED' end,
    provider_object_id = coalesce(provider_object_id, p_provider_object_id),
    failure_code = case when p_succeeded then null else pg_catalog.left(p_failure_code, 255) end,
    completed_at = pg_catalog.now()
  where id = p_attempt_id and status = 'STARTED';
  if not found then raise exception using errcode = 'P0001', message = 'PAYMENT_ATTEMPT_NOT_ACTIVE'; end if;
end
$function$;

create or replace function internal.claim_outbox(p_worker_id text, p_limit integer default 20)
returns table(id uuid, topic text, aggregate_id uuid, payload jsonb)
language plpgsql security definer set search_path = ''
as $function$
begin
  if pg_catalog.length(p_worker_id) < 3 or p_limit not between 1 and 100 then raise exception using errcode = '22023', message = 'INVALID_OUTBOX_LEASE_REQUEST'; end if;
  return query
  with due as (
    select om.id from internal.outbox_messages om
    where om.available_at <= pg_catalog.now() and (om.status = 'PENDING' or (om.status = 'LEASED' and om.lease_expires_at < pg_catalog.now()))
    order by om.available_at for update skip locked limit p_limit
  ), leased as (
    update internal.outbox_messages om set status = 'LEASED', lease_owner = p_worker_id,
      lease_expires_at = pg_catalog.now() + interval '2 minutes', attempts = om.attempts + 1
    from due where om.id = due.id returning om.id, om.topic, om.aggregate_id, om.payload
  ) select leased.id, leased.topic, leased.aggregate_id, leased.payload from leased;
end
$function$;

create or replace function internal.get_outbox_delivery_context(p_outbox_id uuid, p_worker_id text) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'outboxId', om.id, 'topic', om.topic, 'orderId', o.id, 'publicRef', o.public_ref,
    'customerEmail', c.email, 'customerPhone', c.phone,
    'contractorEmail', cc.email, 'contractorPhone', cc.phone
  ) into v_context
  from internal.outbox_messages om
  join domain.orders o on o.id = om.aggregate_id and om.aggregate_type = 'order'
  join domain.customers c on c.id = o.customer_id
  left join domain.order_assignments oa on oa.order_id = o.id and oa.released_at is null
  left join domain.contractor_companies cc on cc.id = oa.contractor_company_id
  where om.id = p_outbox_id and om.status = 'LEASED' and om.lease_owner = p_worker_id;
  if v_context is null then raise exception using errcode = 'P0002', message = 'LEASED_OUTBOX_CONTEXT_NOT_FOUND'; end if;
  return v_context;
end
$function$;

create or replace function internal.begin_notification_delivery(
  p_outbox_id uuid,
  p_order_id uuid,
  p_recipient_type text,
  p_channel text,
  p_template_key text,
  p_destination_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_notification domain.notifications%rowtype; v_key text;
begin
  if p_recipient_type not in ('CUSTOMER','CONTRACTOR','ADMIN') or p_channel not in ('EMAIL','SMS')
     or p_destination_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_DELIVERY'; end if;
  v_key := p_outbox_id::text || ':' || p_recipient_type || ':' || p_channel;
  insert into domain.notifications(order_id, recipient_type, channel, template_key, idempotency_key, destination_hash, status, attempts)
    values (p_order_id, p_recipient_type, p_channel, p_template_key, v_key, p_destination_hash, 'SENDING', 1)
  on conflict (idempotency_key) do update set status = case when domain.notifications.status = 'SENT' then 'SENT'::domain.notification_status else 'SENDING'::domain.notification_status end,
    attempts = domain.notifications.attempts + case when domain.notifications.status = 'SENT' then 0 else 1 end
  returning * into v_notification;
  return pg_catalog.jsonb_build_object('notificationId', v_notification.id, 'shouldSend', v_notification.status <> 'SENT', 'idempotencyKey', v_key);
end
$function$;

create or replace function internal.complete_notification_delivery(p_notification_id uuid, p_succeeded boolean, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update domain.notifications set status = case when p_succeeded then 'SENT'::domain.notification_status else 'FAILED'::domain.notification_status end,
    sent_at = case when p_succeeded then pg_catalog.now() else null end,
    last_error = case when p_succeeded then null else pg_catalog.left(p_error, 1000) end
  where id = p_notification_id and status = 'SENDING';
  if not found then raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_SENDING'; end if;
end
$function$;

create or replace function internal.complete_outbox(p_outbox_id uuid, p_worker_id text, p_succeeded boolean, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update internal.outbox_messages set status = case when p_succeeded then 'COMPLETED'::domain.work_status else 'PENDING'::domain.work_status end,
    completed_at = case when p_succeeded then pg_catalog.now() else null end,
    last_error = case when p_succeeded then null else pg_catalog.left(p_error, 1000) end,
    available_at = case when p_succeeded then available_at else pg_catalog.now() + pg_catalog.make_interval(mins => least(attempts, 10)) end,
    lease_owner = null, lease_expires_at = null
  where id = p_outbox_id and status = 'LEASED' and lease_owner = p_worker_id;
  if not found then raise exception using errcode = 'P0001', message = 'OUTBOX_LEASE_NOT_OWNED'; end if;
end
$function$;

create or replace function internal.record_reconciliation_result(p_payment_generation_id uuid, p_processing_fee_cents integer) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_generation domain.payment_generations%rowtype;
  v_existing_fee integer;
  v_discrepancy integer := 0;
  v_actual_net integer;
  v_run_id uuid;
begin
  if p_processing_fee_cents < 0 then raise exception using errcode = '22023', message = 'INVALID_PROCESSING_FEE'; end if;
  select * into v_generation from domain.payment_generations pg where pg.id = p_payment_generation_id and pg.status = 'CAPTURED' for update;
  if not found then raise exception using errcode = 'P0001', message = 'CAPTURED_GENERATION_REQUIRED'; end if;
  insert into internal.reconciliation_runs(period_start, period_end, status, started_at)
    values (pg_catalog.now() - interval '1 minute', pg_catalog.now(), 'RUNNING', pg_catalog.now()) returning id into v_run_id;
  select fle.amount_cents into v_existing_fee from domain.financial_ledger_entries fle
    where fle.payment_generation_id = v_generation.id and fle.entry_type = 'STRIPE_PROCESSING_FEE' limit 1;
  if v_existing_fee is null then
    insert into domain.financial_ledger_entries(order_id, payment_generation_id, entry_type, amount_cents, provider_reference, occurred_at)
      values (v_generation.order_id, v_generation.id, 'STRIPE_PROCESSING_FEE', p_processing_fee_cents,
        v_generation.provider_payment_intent_id || ':balance_transaction_fee', pg_catalog.now());
    v_existing_fee := p_processing_fee_cents;
  elsif v_existing_fee <> p_processing_fee_cents then
    v_discrepancy := 1;
    insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
      values ('payment.reconciliation_discrepancy', 'order', v_generation.order_id, 'reconciliation:' || v_run_id::text || ':alert',
        pg_catalog.jsonb_build_object('orderId', v_generation.order_id, 'paymentGenerationId', v_generation.id))
      on conflict (idempotency_key) do nothing;
  end if;
  select coalesce(pg_catalog.sum(case fle.entry_type when 'CAPTURE' then fle.amount_cents when 'TRANSFER_REVERSAL' then fle.amount_cents else -fle.amount_cents end), 0)::integer
    into v_actual_net from domain.financial_ledger_entries fle where fle.payment_generation_id = v_generation.id;
  update domain.payment_generations set stripe_processing_fee_cents = coalesce(stripe_processing_fee_cents, v_existing_fee),
    actual_platform_net_transaction_cents = v_actual_net, updated_at = pg_catalog.now() where id = v_generation.id;
  update internal.reconciliation_runs set status = 'COMPLETED', reconciled_count = 1, discrepancy_count = v_discrepancy,
    completed_at = pg_catalog.now() where id = v_run_id;
  return pg_catalog.jsonb_build_object('reconciliationRunId', v_run_id, 'discrepancyCount', v_discrepancy,
    'actualPlatformNetTransactionCents', v_actual_net);
end
$function$;

grant create on schema api, internal to drainly_routine_owner;
alter function internal.consume_rate_limit(text, integer, integer) owner to drainly_routine_owner;
alter function internal.begin_authorization(uuid) owner to drainly_routine_owner;
alter function api.ensure_customer_profile(text) owner to drainly_routine_owner;
alter function api.decline_order_offer(uuid, text) owner to drainly_routine_owner;
alter function internal.get_payment_operation_context(uuid) owner to drainly_routine_owner;
alter function internal.finalize_reassignment(uuid) owner to drainly_routine_owner;
alter function api.reassign_order(uuid, uuid, text, text) owner to drainly_routine_owner;
alter function internal.record_cancellation_and_finalize(uuid) owner to drainly_routine_owner;
alter function api.request_refund(uuid, integer, text, text) owner to drainly_routine_owner;
alter function internal.get_refund_context(uuid) owner to drainly_routine_owner;
alter function internal.record_refund_result(uuid, text, domain.refund_status, integer, text) owner to drainly_routine_owner;
alter function internal.verify_job_proof(uuid, boolean, text) owner to drainly_routine_owner;
alter function internal.record_verified_setup_intent(uuid, text, text, text, text, text, text, timestamptz) owner to drainly_routine_owner;
alter function internal.get_proof_verification_context(uuid) owner to drainly_routine_owner;
alter function api.admin_override_quote_economics(uuid, integer, text, text) owner to drainly_routine_owner;
alter function api.admin_set_contractor_status(uuid, domain.contractor_status, text, text) owner to drainly_routine_owner;
alter function api.cancel_order(uuid, text, text) owner to drainly_routine_owner;
alter function internal.record_order_cancellation_release(uuid) owner to drainly_routine_owner;
alter function internal.process_dispute_webhook(text, text, boolean, text, text, text, integer, text, integer) owner to drainly_routine_owner;
alter function internal.begin_payment_attempt(uuid, text, text) owner to drainly_routine_owner;
alter function internal.complete_payment_attempt(uuid, boolean, text, text) owner to drainly_routine_owner;
alter function internal.claim_outbox(text, integer) owner to drainly_routine_owner;
alter function internal.get_outbox_delivery_context(uuid, text) owner to drainly_routine_owner;
alter function internal.begin_notification_delivery(uuid, uuid, text, text, text, text) owner to drainly_routine_owner;
alter function internal.complete_notification_delivery(uuid, boolean, text) owner to drainly_routine_owner;
alter function internal.complete_outbox(uuid, text, boolean, text) owner to drainly_routine_owner;
alter function internal.record_reconciliation_result(uuid, integer) owner to drainly_routine_owner;
revoke create on schema api, internal from drainly_routine_owner;

revoke all on function internal.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function internal.begin_authorization(uuid) from public, anon, authenticated;
revoke all on function api.ensure_customer_profile(text) from public, anon, authenticated;
revoke all on function api.decline_order_offer(uuid, text) from public, anon, authenticated;
revoke all on function internal.get_payment_operation_context(uuid) from public, anon, authenticated;
revoke all on function internal.finalize_reassignment(uuid) from public, anon, authenticated;
revoke all on function api.reassign_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function internal.record_cancellation_and_finalize(uuid) from public, anon, authenticated;
revoke all on function api.request_refund(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function internal.get_refund_context(uuid) from public, anon, authenticated;
revoke all on function internal.record_refund_result(uuid, text, domain.refund_status, integer, text) from public, anon, authenticated;
revoke all on function internal.verify_job_proof(uuid, boolean, text) from public, anon, authenticated;
revoke all on function internal.record_verified_setup_intent(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function internal.get_proof_verification_context(uuid) from public, anon, authenticated;
revoke all on function api.admin_override_quote_economics(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function api.admin_set_contractor_status(uuid, domain.contractor_status, text, text) from public, anon, authenticated;
revoke all on function api.cancel_order(uuid, text, text) from public, anon, authenticated;
revoke all on function internal.record_order_cancellation_release(uuid) from public, anon, authenticated;
revoke all on function internal.process_dispute_webhook(text, text, boolean, text, text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function internal.begin_payment_attempt(uuid, text, text) from public, anon, authenticated;
revoke all on function internal.complete_payment_attempt(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function internal.claim_outbox(text, integer) from public, anon, authenticated;
revoke all on function internal.get_outbox_delivery_context(uuid, text) from public, anon, authenticated;
revoke all on function internal.begin_notification_delivery(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function internal.complete_notification_delivery(uuid, boolean, text) from public, anon, authenticated;
revoke all on function internal.complete_outbox(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function internal.record_reconciliation_result(uuid, integer) from public, anon, authenticated;

grant execute on function api.reassign_order(uuid, uuid, text, text) to authenticated;
grant execute on function api.ensure_customer_profile(text) to authenticated;
grant execute on function api.decline_order_offer(uuid, text) to authenticated;
grant execute on function api.request_refund(uuid, integer, text, text) to authenticated;
grant execute on function internal.consume_rate_limit(text, integer, integer) to drainly_system;
grant execute on function internal.begin_authorization(uuid) to drainly_system;
grant execute on function internal.get_payment_operation_context(uuid) to drainly_system;
grant execute on function internal.finalize_reassignment(uuid) to drainly_system;
grant execute on function internal.record_cancellation_and_finalize(uuid) to drainly_system;
grant execute on function internal.get_refund_context(uuid) to drainly_system;
grant execute on function internal.record_refund_result(uuid, text, domain.refund_status, integer, text) to drainly_system;
grant execute on function internal.verify_job_proof(uuid, boolean, text) to drainly_system;
grant execute on function internal.record_verified_setup_intent(uuid, text, text, text, text, text, text, timestamptz) to drainly_system;
grant execute on function internal.get_proof_verification_context(uuid) to drainly_system;
grant execute on function api.admin_override_quote_economics(uuid, integer, text, text) to authenticated;
grant execute on function api.admin_set_contractor_status(uuid, domain.contractor_status, text, text) to authenticated;
grant execute on function api.cancel_order(uuid, text, text) to authenticated;
grant execute on function internal.record_order_cancellation_release(uuid) to drainly_system;
grant execute on function internal.process_dispute_webhook(text, text, boolean, text, text, text, integer, text, integer) to drainly_system;
grant execute on function internal.begin_payment_attempt(uuid, text, text) to drainly_system;
grant execute on function internal.complete_payment_attempt(uuid, boolean, text, text) to drainly_system;
grant execute on function internal.claim_outbox(text, integer) to drainly_system;
grant execute on function internal.get_outbox_delivery_context(uuid, text) to drainly_system;
grant execute on function internal.begin_notification_delivery(uuid, uuid, text, text, text, text) to drainly_system;
grant execute on function internal.complete_notification_delivery(uuid, boolean, text) to drainly_system;
grant execute on function internal.complete_outbox(uuid, text, boolean, text) to drainly_system;
grant execute on function internal.record_reconciliation_result(uuid, integer) to drainly_system;

-- Effective routine-owner table privileges are an explicit allowlist. The role
-- remains subject to the named RLS policies created in the foundation migration.
revoke all privileges on all tables in schema domain, internal from drainly_routine_owner;

grant select on domain.customers, domain.contractor_companies, domain.contractor_users, domain.platform_admins,
  domain.contractor_verifications, domain.service_regions, domain.contractor_service_regions,
  domain.contractor_availability, domain.contractor_blackout_dates, domain.contractor_day_capacity,
  domain.marketplace_settings, domain.regional_price_books, domain.regional_price_rules, domain.properties,
  domain.contractor_price_books, domain.contractor_price_rules, domain.contractor_fee_configs,
  domain.quotes, domain.quote_candidates, domain.quote_economics_overrides, domain.orders,
  domain.order_offers, domain.order_assignments, domain.payment_generations, domain.refunds,
  domain.financial_ledger_entries, domain.order_events, domain.job_proofs, domain.notifications
to drainly_routine_owner;

grant insert on domain.customers, domain.properties, domain.quotes, domain.quote_candidates,
  domain.quote_economics_overrides, domain.orders, domain.order_offers, domain.order_assignments,
  domain.contractor_day_capacity, domain.payment_generations, domain.refunds,
  domain.financial_ledger_entries, domain.order_events, domain.job_proofs, domain.notifications,
  domain.audit_records
to drainly_routine_owner;

grant update on domain.customers, domain.contractor_companies, domain.quotes, domain.quote_candidates,
  domain.orders, domain.order_offers, domain.order_assignments, domain.contractor_day_capacity, domain.payment_generations,
  domain.refunds, domain.job_proofs, domain.notifications
to drainly_routine_owner;

grant select, insert, update on internal.webhook_events, internal.scheduled_tasks,
  internal.outbox_messages, internal.rate_limit_buckets, internal.verified_setup_intents,
  internal.payment_attempts, internal.reconciliation_runs, internal.provider_disputes
to drainly_routine_owner;

-- Role-specific UI gates remain security-invoker views, so the underlying
-- self-only RLS policies are authoritative and no membership is inferred from
-- an empty operational list.
create view api.current_customer_context with (security_invoker = true) as
select c.id as customer_id, c.auth_user_id, c.email
from domain.customers c
where c.auth_user_id = identity.uid();

create view api.current_contractor_context with (security_invoker = true) as
select cu.auth_user_id as contractor_user_id, cu.contractor_company_id, cu.auth_user_id,
  cu.active as user_active, cc.status as company_status, cc.legal_name as company_name
from domain.contractor_users cu
join domain.contractor_companies cc on cc.id = cu.contractor_company_id
where cu.auth_user_id = identity.uid() and cu.active;

create view api.current_admin_context with (security_invoker = true) as
select pa.auth_user_id as admin_id, pa.auth_user_id, pa.active
from domain.platform_admins pa
where pa.auth_user_id = identity.uid() and pa.active;

revoke all on api.current_customer_context, api.current_contractor_context, api.current_admin_context from public, anon;
grant select on api.current_customer_context, api.current_contractor_context, api.current_admin_context to authenticated;

commit;
