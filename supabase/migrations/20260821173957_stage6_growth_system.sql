begin;

create table if not exists domain.growth_leads (
  id uuid primary key default extensions.gen_random_uuid(),
  lead_type text not null check (lead_type in ('CUSTOMER_WAITLIST','CONTRACTOR_INTEREST')),
  email text not null check (pg_catalog.length(email) between 5 and 254),
  county_code text not null default 'UNKNOWN' check (county_code in ('JOHNSTON_NC','HARNETT_NC','UNKNOWN','OTHER')),
  source text not null check (source in ('HOME_UNAVAILABLE','HOME_UNSUPPORTED','CONTRACTOR_PAGE','SERVICE_AREA','REFERRAL','OTHER')),
  status text not null default 'NEW' check (status in ('NEW','CONTACTED','CONVERTED','CLOSED')),
  consent_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create unique index if not exists growth_leads_type_email_key
  on domain.growth_leads (lead_type, pg_catalog.lower(email));

create table if not exists domain.customer_growth_preferences (
  customer_id uuid primary key references domain.customers(id) on delete cascade,
  annual_service_checkin boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now()
);

create table if not exists domain.referral_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null unique references domain.customers(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8,16}$'),
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists domain.referral_visits (
  id uuid primary key default extensions.gen_random_uuid(),
  referral_code_id uuid not null references domain.referral_codes(id) on delete cascade,
  landing_path text not null check (pg_catalog.length(landing_path) between 1 and 120),
  created_at timestamptz not null default pg_catalog.now()
);
create index if not exists referral_visits_code_created_idx on domain.referral_visits(referral_code_id, created_at desc);

create table if not exists domain.referral_attributions (
  id uuid primary key default extensions.gen_random_uuid(),
  referral_code_id uuid not null references domain.referral_codes(id) on delete cascade,
  quote_id uuid not null unique references domain.quotes(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists domain.growth_experiments (
  id uuid primary key default extensions.gen_random_uuid(),
  experiment_key text not null unique check (experiment_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  hypothesis text not null check (pg_catalog.length(hypothesis) between 10 and 1000),
  guardrail text not null check (pg_catalog.length(guardrail) between 5 and 1000),
  status text not null default 'DRAFT' check (status in ('DRAFT','RUNNING','PAUSED','COMPLETED')),
  created_by uuid not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create or replace function internal.capture_growth_lead(
  p_lead_type text,
  p_email text,
  p_county_code text,
  p_source text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_id uuid;
begin
  if p_lead_type not in ('CUSTOMER_WAITLIST','CONTRACTOR_INTEREST')
     or p_county_code not in ('JOHNSTON_NC','HARNETT_NC','UNKNOWN','OTHER')
     or p_source not in ('HOME_UNAVAILABLE','HOME_UNSUPPORTED','CONTRACTOR_PAGE','SERVICE_AREA','REFERRAL','OTHER')
     or pg_catalog.length(v_email) not between 5 and 254
     or pg_catalog.strpos(v_email,'@') <= 1 then
    raise exception using errcode = '22023', message = 'INVALID_GROWTH_LEAD';
  end if;

  insert into domain.growth_leads(lead_type,email,county_code,source,consent_at)
  values (p_lead_type,v_email,p_county_code,p_source,pg_catalog.now())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select gl.id into strict v_id
    from domain.growth_leads gl
    where gl.lead_type = p_lead_type and pg_catalog.lower(gl.email) = v_email;

    update domain.growth_leads
    set county_code = p_county_code,
        source = p_source,
        consent_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = v_id;
  end if;

  return pg_catalog.jsonb_build_object('accepted', true, 'leadId', v_id);
end
$function$;

create or replace function internal.get_customer_growth_bundle(p_auth_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_customer_id uuid;
  v_opt_in boolean := false;
  v_code text;
  v_eligible boolean := false;
begin
  select c.id into v_customer_id from domain.customers c where c.auth_user_id = p_auth_user_id;
  if v_customer_id is null then
    return pg_catalog.jsonb_build_object(
      'customerExists', false,
      'annualServiceCheckin', false,
      'referralEligible', false,
      'referralCode', null
    );
  end if;

  select coalesce(cgp.annual_service_checkin,false) into v_opt_in
  from domain.customer_growth_preferences cgp where cgp.customer_id = v_customer_id;
  if not found then v_opt_in := false; end if;

  select rc.code into v_code from domain.referral_codes rc where rc.customer_id = v_customer_id and rc.active;
  select exists(select 1 from domain.orders o where o.customer_id = v_customer_id and o.status = 'CLOSED') into v_eligible;

  return pg_catalog.jsonb_build_object(
    'customerExists', true,
    'annualServiceCheckin', v_opt_in,
    'referralEligible', v_eligible,
    'referralCode', v_code
  );
end
$function$;

create or replace function internal.save_customer_growth_preferences(
  p_auth_user_id uuid,
  p_annual_service_checkin boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_customer_id uuid;
begin
  select c.id into v_customer_id from domain.customers c where c.auth_user_id = p_auth_user_id;
  if v_customer_id is null then
    raise exception using errcode = 'P0002', message = 'CUSTOMER_PROFILE_REQUIRED';
  end if;

  insert into domain.customer_growth_preferences(customer_id,annual_service_checkin,updated_at)
  values (v_customer_id,p_annual_service_checkin,pg_catalog.now())
  on conflict (customer_id) do update
  set annual_service_checkin = excluded.annual_service_checkin,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('annualServiceCheckin', p_annual_service_checkin);
end
$function$;

create or replace function internal.ensure_customer_referral_code(p_auth_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_customer_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  select c.id into v_customer_id from domain.customers c where c.auth_user_id = p_auth_user_id;
  if v_customer_id is null then raise exception using errcode = 'P0002', message = 'CUSTOMER_PROFILE_REQUIRED'; end if;
  if not exists(select 1 from domain.orders o where o.customer_id = v_customer_id and o.status = 'CLOSED') then
    raise exception using errcode = 'P0001', message = 'REFERRAL_REQUIRES_COMPLETED_ORDER';
  end if;

  select rc.code into v_code from domain.referral_codes rc where rc.customer_id = v_customer_id and rc.active;
  if v_code is not null then return pg_catalog.jsonb_build_object('code', v_code); end if;

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 5 then raise exception using errcode = 'P0001', message = 'REFERRAL_CODE_GENERATION_FAILED'; end if;
    v_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(extensions.gen_random_uuid()::text,'-',''),1,10));
    begin
      insert into domain.referral_codes(customer_id,code) values (v_customer_id,v_code);
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  return pg_catalog.jsonb_build_object('code', v_code);
end
$function$;

create or replace function internal.record_referral_visit(p_code text, p_landing_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_referral_code_id uuid;
begin
  if p_landing_path is null or pg_catalog.length(p_landing_path) not between 1 and 120 or pg_catalog.left(p_landing_path,1) <> '/' then
    raise exception using errcode = '22023', message = 'INVALID_REFERRAL_LANDING_PATH';
  end if;
  select rc.id into v_referral_code_id
  from domain.referral_codes rc
  where rc.code = pg_catalog.upper(pg_catalog.btrim(p_code)) and rc.active;
  if v_referral_code_id is null then return false; end if;
  insert into domain.referral_visits(referral_code_id,landing_path) values (v_referral_code_id,p_landing_path);
  return true;
end
$function$;

create or replace function internal.attribute_referral_quote(p_code text, p_quote_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_referral_code_id uuid;
begin
  select rc.id into v_referral_code_id
  from domain.referral_codes rc
  where rc.code = pg_catalog.upper(pg_catalog.btrim(p_code)) and rc.active;
  if v_referral_code_id is null or not exists(select 1 from domain.quotes q where q.id = p_quote_id) then return false; end if;
  insert into domain.referral_attributions(referral_code_id,quote_id)
  values (v_referral_code_id,p_quote_id)
  on conflict (quote_id) do nothing;
  return true;
end
$function$;

create or replace function internal.seed_growth_service_checkins()
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare v_count integer := 0;
begin
  insert into internal.scheduled_tasks(task_type,aggregate_type,aggregate_id,due_at,idempotency_key,payload)
  select
    'SEND_GROWTH_SERVICE_CHECKIN',
    'order',
    o.id,
    o.updated_at + interval '1 year',
    'growth-service-checkin:' || o.id::text,
    pg_catalog.jsonb_build_object('orderId',o.id)
  from domain.orders o
  join domain.customer_growth_preferences cgp on cgp.customer_id = o.customer_id and cgp.annual_service_checkin
  where o.status = 'CLOSED'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

create or replace function internal.enqueue_growth_service_checkin(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order domain.orders%rowtype;
begin
  select * into v_order from domain.orders o where o.id = p_order_id;
  if not found or v_order.status <> 'CLOSED' or not exists(
    select 1 from domain.customer_growth_preferences cgp
    where cgp.customer_id = v_order.customer_id and cgp.annual_service_checkin
  ) then
    return pg_catalog.jsonb_build_object('enqueued', false);
  end if;

  insert into internal.outbox_messages(topic,aggregate_type,aggregate_id,idempotency_key,payload)
  values (
    'growth.service_checkin','order',v_order.id,
    'growth-service-checkin:' || v_order.id::text || ':email',
    pg_catalog.jsonb_build_object('orderId',v_order.id)
  )
  on conflict (idempotency_key) do nothing;

  return pg_catalog.jsonb_build_object('enqueued', true);
end
$function$;

create or replace function internal.claim_due_notification_work(p_worker_id text, p_limit integer default 20)
returns table(id uuid, task_type text, aggregate_id uuid, payload jsonb)
language plpgsql security definer set search_path = ''
as $function$
begin
  if pg_catalog.length(p_worker_id) < 3 or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_WORK_LEASE_REQUEST';
  end if;

  return query
  with due as (
    select st.id
    from internal.scheduled_tasks st
    where st.task_type in ('SEND_SERVICE_REMINDER','SEND_GROWTH_SERVICE_CHECKIN')
      and st.due_at <= pg_catalog.now()
      and (st.status = 'PENDING' or (st.status = 'LEASED' and st.lease_expires_at < pg_catalog.now()))
    order by st.due_at
    for update skip locked
    limit p_limit
  ), leased as (
    update internal.scheduled_tasks st
    set status = 'LEASED',
        lease_owner = p_worker_id,
        lease_expires_at = pg_catalog.now() + interval '2 minutes',
        attempts = st.attempts + 1
    from due
    where st.id = due.id
    returning st.id, st.task_type, st.aggregate_id, st.payload
  )
  select leased.id, leased.task_type, leased.aggregate_id, leased.payload from leased;
end
$function$;

create or replace function internal.growth_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_quotes_7 integer;
  v_quotes_prev_7 integer;
  v_quotes_30 integer;
  v_priced_30 integer;
  v_converted_30 integer;
  v_orders_30 integer;
  v_closed_30 integer;
  v_cancelled_30 integer;
  v_volume_30 bigint;
  v_customer_leads_30 integer;
  v_contractor_leads_30 integer;
  v_referral_visits_30 integer;
  v_referral_conversions_30 integer;
  v_referral_codes integer;
  v_checkin_optins integer;
  v_contractors integer;
  v_approved_contractors integer;
  v_connect_ready integer;
  v_running_experiments integer;
begin
  select pg_catalog.count(*)::integer into v_quotes_7 from domain.quotes q where q.created_at >= pg_catalog.now() - interval '7 days';
  select pg_catalog.count(*)::integer into v_quotes_prev_7 from domain.quotes q where q.created_at >= pg_catalog.now() - interval '14 days' and q.created_at < pg_catalog.now() - interval '7 days';
  select pg_catalog.count(*)::integer into v_quotes_30 from domain.quotes q where q.created_at >= pg_catalog.now() - interval '30 days';
  select pg_catalog.count(*)::integer into v_priced_30 from domain.quotes q where q.created_at >= pg_catalog.now() - interval '30 days' and q.status = 'PRICED';
  select pg_catalog.count(*)::integer into v_converted_30 from domain.quotes q where q.created_at >= pg_catalog.now() - interval '30 days' and q.converted_at is not null;
  select pg_catalog.count(*)::integer into v_orders_30 from domain.orders o where o.created_at >= pg_catalog.now() - interval '30 days';
  select pg_catalog.count(*)::integer into v_closed_30 from domain.orders o where o.created_at >= pg_catalog.now() - interval '30 days' and o.status = 'CLOSED';
  select pg_catalog.count(*)::integer into v_cancelled_30 from domain.orders o where o.created_at >= pg_catalog.now() - interval '30 days' and o.status = 'CANCELLED';
  select coalesce(pg_catalog.sum(o.customer_total_cents),0)::bigint into v_volume_30 from domain.orders o where o.created_at >= pg_catalog.now() - interval '30 days';
  select pg_catalog.count(*)::integer into v_customer_leads_30 from domain.growth_leads gl where gl.created_at >= pg_catalog.now() - interval '30 days' and gl.lead_type = 'CUSTOMER_WAITLIST';
  select pg_catalog.count(*)::integer into v_contractor_leads_30 from domain.growth_leads gl where gl.created_at >= pg_catalog.now() - interval '30 days' and gl.lead_type = 'CONTRACTOR_INTEREST';
  select pg_catalog.count(*)::integer into v_referral_visits_30 from domain.referral_visits rv where rv.created_at >= pg_catalog.now() - interval '30 days';
  select pg_catalog.count(*)::integer into v_referral_conversions_30 from domain.referral_attributions ra where ra.created_at >= pg_catalog.now() - interval '30 days';
  select pg_catalog.count(*)::integer into v_referral_codes from domain.referral_codes rc where rc.active;
  select pg_catalog.count(*)::integer into v_checkin_optins from domain.customer_growth_preferences cgp where cgp.annual_service_checkin;
  select pg_catalog.count(*)::integer into v_contractors from domain.contractor_companies;
  select pg_catalog.count(*)::integer into v_approved_contractors from domain.contractor_companies cc where cc.status = 'APPROVED';
  select pg_catalog.count(*)::integer into v_connect_ready from domain.contractor_companies cc where cc.stripe_connect_ready and cc.stripe_transfer_capability_status = 'active';
  select pg_catalog.count(*)::integer into v_running_experiments from domain.growth_experiments ge where ge.status = 'RUNNING';

  return pg_catalog.jsonb_build_object(
    'quotes7d',v_quotes_7,
    'quotesPrevious7d',v_quotes_prev_7,
    'quotes30d',v_quotes_30,
    'pricedQuotes30d',v_priced_30,
    'convertedQuotes30d',v_converted_30,
    'quoteConversionRate30d',case when v_quotes_30 = 0 then 0 else pg_catalog.round((v_converted_30::numeric / v_quotes_30::numeric) * 100,2) end,
    'orders30d',v_orders_30,
    'closedOrders30d',v_closed_30,
    'cancelledOrders30d',v_cancelled_30,
    'customerVolumeCents30d',v_volume_30,
    'customerLeads30d',v_customer_leads_30,
    'contractorLeads30d',v_contractor_leads_30,
    'referralVisits30d',v_referral_visits_30,
    'referralConversions30d',v_referral_conversions_30,
    'activeReferralCodes',v_referral_codes,
    'annualCheckinOptIns',v_checkin_optins,
    'contractorCount',v_contractors,
    'approvedContractorCount',v_approved_contractors,
    'connectReadyContractorCount',v_connect_ready,
    'runningExperiments',v_running_experiments
  );
end
$function$;

create or replace function internal.growth_experiments_snapshot()
returns jsonb
language sql stable security definer set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'experimentKey',ge.experiment_key,
      'hypothesis',ge.hypothesis,
      'guardrail',ge.guardrail,
      'status',ge.status,
      'startedAt',ge.started_at,
      'endedAt',ge.ended_at,
      'updatedAt',ge.updated_at
    ) order by ge.updated_at desc),
    '[]'::pg_catalog.jsonb
  )
  from domain.growth_experiments ge
$function$;

create or replace function internal.set_growth_experiment(
  p_actor_user_id uuid,
  p_experiment_key text,
  p_hypothesis text,
  p_guardrail text,
  p_status text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_row domain.growth_experiments%rowtype;
begin
  if not exists(select 1 from domain.platform_admins pa where pa.auth_user_id = p_actor_user_id and pa.active) then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_experiment_key !~ '^[a-z0-9][a-z0-9_-]{2,63}$'
     or pg_catalog.length(p_hypothesis) not between 10 and 1000
     or pg_catalog.length(p_guardrail) not between 5 and 1000
     or p_status not in ('DRAFT','RUNNING','PAUSED','COMPLETED') then
    raise exception using errcode = '22023', message = 'INVALID_GROWTH_EXPERIMENT';
  end if;

  insert into domain.growth_experiments(experiment_key,hypothesis,guardrail,status,created_by,started_at,ended_at)
  values (
    p_experiment_key,p_hypothesis,p_guardrail,p_status,p_actor_user_id,
    case when p_status = 'RUNNING' then pg_catalog.now() else null end,
    case when p_status = 'COMPLETED' then pg_catalog.now() else null end
  )
  on conflict (experiment_key) do update
  set hypothesis = excluded.hypothesis,
      guardrail = excluded.guardrail,
      status = excluded.status,
      started_at = case when excluded.status = 'RUNNING' and domain.growth_experiments.started_at is null then pg_catalog.now() else domain.growth_experiments.started_at end,
      ended_at = case when excluded.status = 'COMPLETED' then pg_catalog.now() when excluded.status <> 'COMPLETED' then null else domain.growth_experiments.ended_at end,
      updated_at = pg_catalog.now()
  returning * into v_row;

  insert into domain.audit_records(actor_user_id,actor_type,action,resource_type,resource_id,reason,metadata)
  values (
    p_actor_user_id,'ADMIN','GROWTH_EXPERIMENT_CHANGED','growth_experiment',v_row.id,
    'Growth experiment registry updated',
    pg_catalog.jsonb_build_object('experimentKey',v_row.experiment_key,'status',v_row.status)
  );

  return pg_catalog.jsonb_build_object(
    'experimentKey',v_row.experiment_key,
    'status',v_row.status,
    'updatedAt',v_row.updated_at
  );
end
$function$;

create or replace view api.current_customer_context
with (security_invoker = true)
as
select c.id as customer_id, c.auth_user_id, c.email
from domain.customers c
where c.auth_user_id = identity.uid();

create or replace view api.customer_orders
with (security_invoker = true)
as
select
  o.id,
  o.public_ref,
  o.status,
  o.tank_tier,
  o.timing_kind,
  o.access_type,
  o.requested_service_date,
  o.address_snapshot,
  o.customer_total_cents,
  o.created_at,
  pg.status as payment_status
from domain.orders o
join domain.customers c on c.id = o.customer_id and c.auth_user_id = identity.uid()
left join domain.payment_generations pg on pg.order_id = o.id and pg.is_current;

grant select on domain.growth_leads, domain.customer_growth_preferences, domain.referral_codes, domain.referral_visits, domain.referral_attributions, domain.growth_experiments to drainly_routine_owner;
grant insert, update on domain.growth_leads, domain.customer_growth_preferences, domain.referral_codes, domain.growth_experiments to drainly_routine_owner;
grant insert on domain.referral_visits, domain.referral_attributions to drainly_routine_owner;
grant select on domain.customers, domain.orders, domain.quotes, domain.contractor_companies, domain.platform_admins to drainly_routine_owner;
grant select, insert on internal.scheduled_tasks, internal.outbox_messages to drainly_routine_owner;

grant create on schema internal to drainly_routine_owner;
alter function internal.capture_growth_lead(text,text,text,text) owner to drainly_routine_owner;
alter function internal.get_customer_growth_bundle(uuid) owner to drainly_routine_owner;
alter function internal.save_customer_growth_preferences(uuid,boolean) owner to drainly_routine_owner;
alter function internal.ensure_customer_referral_code(uuid) owner to drainly_routine_owner;
alter function internal.record_referral_visit(text,text) owner to drainly_routine_owner;
alter function internal.attribute_referral_quote(text,uuid) owner to drainly_routine_owner;
alter function internal.seed_growth_service_checkins() owner to drainly_routine_owner;
alter function internal.enqueue_growth_service_checkin(uuid) owner to drainly_routine_owner;
alter function internal.claim_due_notification_work(text,integer) owner to drainly_routine_owner;
alter function internal.growth_dashboard() owner to drainly_routine_owner;
alter function internal.growth_experiments_snapshot() owner to drainly_routine_owner;
alter function internal.set_growth_experiment(uuid,text,text,text,text) owner to drainly_routine_owner;
revoke create on schema internal from drainly_routine_owner;

revoke all on function internal.capture_growth_lead(text,text,text,text) from public, anon, authenticated;
revoke all on function internal.get_customer_growth_bundle(uuid) from public, anon, authenticated;
revoke all on function internal.save_customer_growth_preferences(uuid,boolean) from public, anon, authenticated;
revoke all on function internal.ensure_customer_referral_code(uuid) from public, anon, authenticated;
revoke all on function internal.record_referral_visit(text,text) from public, anon, authenticated;
revoke all on function internal.attribute_referral_quote(text,uuid) from public, anon, authenticated;
revoke all on function internal.seed_growth_service_checkins() from public, anon, authenticated;
revoke all on function internal.enqueue_growth_service_checkin(uuid) from public, anon, authenticated;
revoke all on function internal.growth_dashboard() from public, anon, authenticated;
revoke all on function internal.growth_experiments_snapshot() from public, anon, authenticated;
revoke all on function internal.set_growth_experiment(uuid,text,text,text,text) from public, anon, authenticated;

grant execute on function internal.capture_growth_lead(text,text,text,text) to drainly_system;
grant execute on function internal.get_customer_growth_bundle(uuid) to drainly_system;
grant execute on function internal.save_customer_growth_preferences(uuid,boolean) to drainly_system;
grant execute on function internal.ensure_customer_referral_code(uuid) to drainly_system;
grant execute on function internal.record_referral_visit(text,text) to drainly_system;
grant execute on function internal.attribute_referral_quote(text,uuid) to drainly_system;
grant execute on function internal.seed_growth_service_checkins() to drainly_system;
grant execute on function internal.enqueue_growth_service_checkin(uuid) to drainly_system;
grant execute on function internal.claim_due_notification_work(text,integer) to drainly_system;
grant execute on function internal.growth_dashboard() to drainly_system;
grant execute on function internal.growth_experiments_snapshot() to drainly_system;
grant execute on function internal.set_growth_experiment(uuid,text,text,text,text) to drainly_system;

grant select on api.current_customer_context, api.customer_orders to authenticated;

commit;
