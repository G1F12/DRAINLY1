-- Stage 4: contractor-set pricing and deterministic marketplace matching.
-- This is a preview/matching boundary only. It does not create orders, offers, assignments, or payments.

grant usage, create on schema internal to drainly_routine_owner;
grant usage, create on schema api to drainly_routine_owner;
grant select on domain.contractor_companies to drainly_routine_owner;
grant select on domain.contractor_service_regions to drainly_routine_owner;
grant select on domain.contractor_availability to drainly_routine_owner;
grant select on domain.contractor_blackout_dates to drainly_routine_owner;
grant select on domain.contractor_price_books to drainly_routine_owner;
grant select on domain.contractor_price_rules to drainly_routine_owner;
grant select on domain.order_assignments to drainly_routine_owner;
grant select on domain.orders to drainly_routine_owner;
grant select on domain.service_regions to drainly_routine_owner;

create or replace function internal.marketplace_ranked_candidates(
  p_service_region_id uuid,
  p_tank_tier domain.tank_tier,
  p_timing_kind domain.timing_kind,
  p_requested_service_date date
) returns table(
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
language sql security definer stable set search_path = ''
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
      (
        cc.stripe_connected_account_id is not null
        and cc.stripe_details_submitted
        and cc.stripe_charges_enabled
        and cc.stripe_payouts_enabled
      ) as payment_ready
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
    select
      cb.*,
      (cb.assigned_jobs::numeric / greatest(cb.max_jobs, 1)) as utilization
    from candidate_base cb
    where cb.assigned_jobs < cb.max_jobs
  )
  select
    row_number() over (
      order by e.contractor_gross_cents asc, e.utilization asc, e.priority asc, e.contractor_company_id asc
    )::integer as rank,
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

create or replace function api.marketplace_match_preview(
  p_region_key text,
  p_tank_tier domain.tank_tier,
  p_timing_kind domain.timing_kind,
  p_requested_service_date date
) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare
  v_region_id uuid;
  v_result jsonb;
begin
  if p_requested_service_date < (pg_catalog.now() at time zone 'America/New_York')::date then
    raise exception using errcode = '22023', message = 'SERVICE_DATE_IN_PAST';
  end if;

  if p_tank_tier = 'UNKNOWN' then
    return pg_catalog.jsonb_build_object(
      'status', 'REVIEW_REQUIRED',
      'pricingModel', 'CONTRACTOR_SET',
      'dispatchMode', case when p_timing_kind = 'URGENT' then 'URGENT_BROADCAST' else 'PLANNED_CONFIRMATION' end,
      'candidateCount', 0,
      'paymentReadyCandidateCount', 0
    );
  end if;

  select sr.id into v_region_id
  from domain.service_regions sr
  where sr.normalized_key = p_region_key and sr.active;

  if v_region_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'UNSUPPORTED',
      'pricingModel', 'CONTRACTOR_SET',
      'dispatchMode', case when p_timing_kind = 'URGENT' then 'URGENT_BROADCAST' else 'PLANNED_CONFIRMATION' end,
      'candidateCount', 0,
      'paymentReadyCandidateCount', 0
    );
  end if;

  with ranked as (
    select * from internal.marketplace_ranked_candidates(
      v_region_id, p_tank_tier, p_timing_kind, p_requested_service_date
    )
  )
  select pg_catalog.jsonb_build_object(
    'status', case when pg_catalog.count(*) > 0 then 'MATCHED' else 'UNAVAILABLE' end,
    'pricingModel', 'CONTRACTOR_SET',
    'customerSubtotalCents', (select r.contractor_gross_cents from ranked r order by r.rank limit 1),
    'customerFeeCents', case when pg_catalog.count(*) > 0 then 0 else null end,
    'customerTotalCents', (select r.contractor_gross_cents from ranked r order by r.rank limit 1),
    'selectedPriceBookVersion', (select r.contractor_price_book_version from ranked r order by r.rank limit 1),
    'candidateCount', pg_catalog.count(*)::integer,
    'paymentReadyCandidateCount', (pg_catalog.count(*) filter (where payment_ready))::integer,
    'bestCandidatePaymentReady', (select r.payment_ready from ranked r order by r.rank limit 1),
    'dispatchMode', case when p_timing_kind = 'URGENT' then 'URGENT_BROADCAST' else 'PLANNED_CONFIRMATION' end,
    'offerFanout', case when p_timing_kind = 'URGENT' then least(pg_catalog.count(*)::integer, 3) else least(pg_catalog.count(*)::integer, 1) end,
    'rankingPolicy', 'PRICE_THEN_UTILIZATION_THEN_PRIORITY'
  ) into v_result
  from ranked;

  return v_result;
end
$function$;

alter function internal.marketplace_ranked_candidates(uuid,domain.tank_tier,domain.timing_kind,date) owner to drainly_routine_owner;
alter function api.marketplace_match_preview(text,domain.tank_tier,domain.timing_kind,date) owner to drainly_routine_owner;

revoke all on function internal.marketplace_ranked_candidates(uuid,domain.tank_tier,domain.timing_kind,date) from public, anon, authenticated;
revoke all on function api.marketplace_match_preview(text,domain.tank_tier,domain.timing_kind,date) from public;
grant execute on function api.marketplace_match_preview(text,domain.tank_tier,domain.timing_kind,date) to anon, authenticated;

revoke create on schema internal from drainly_routine_owner;
revoke create on schema api from drainly_routine_owner;
