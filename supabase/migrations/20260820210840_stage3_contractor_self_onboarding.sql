-- Stage 3: authenticated contractor supply onboarding.
-- This intentionally does not activate live dispatch or Stripe. New companies remain PENDING.

grant usage, create on schema api to drainly_routine_owner;
grant select, insert, update on domain.contractor_companies to drainly_routine_owner;
grant select, insert, update on domain.contractor_users to drainly_routine_owner;
grant select, insert, delete on domain.contractor_service_regions to drainly_routine_owner;
grant select, insert, update on domain.service_regions to drainly_routine_owner;
grant select, insert, update, delete on domain.contractor_availability to drainly_routine_owner;
grant select, insert, update on domain.contractor_price_books to drainly_routine_owner;
grant select, insert on domain.contractor_price_rules to drainly_routine_owner;
grant select, insert, update on domain.contractor_verifications to drainly_routine_owner;
grant select, insert on domain.audit_records to drainly_routine_owner;

create or replace function api.contractor_onboarding_get() returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare
  v_uid uuid := identity.uid();
  v_memberships integer;
  v_company_id uuid;
  v_role text;
  v_user_active boolean;
  v_company domain.contractor_companies%rowtype;
  v_price_book_id uuid;
  v_price_book_version integer;
  v_regions jsonb := '[]'::pg_catalog.jsonb;
  v_availability jsonb := '[]'::pg_catalog.jsonb;
  v_prices jsonb := '[]'::pg_catalog.jsonb;
  v_verifications jsonb := '[]'::pg_catalog.jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select pg_catalog.count(*)::integer into v_memberships
  from domain.contractor_users cu
  where cu.auth_user_id = v_uid;

  if v_memberships = 0 then
    return pg_catalog.jsonb_build_object('exists', false);
  elsif v_memberships > 1 then
    raise exception using errcode = 'P0001', message = 'MULTIPLE_CONTRACTOR_COMPANIES_UNSUPPORTED';
  end if;

  select cu.contractor_company_id, cu.role, cu.active
  into v_company_id, v_role, v_user_active
  from domain.contractor_users cu
  where cu.auth_user_id = v_uid;

  select * into strict v_company
  from domain.contractor_companies cc
  where cc.id = v_company_id;

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', sr.id,
        'kind', sr.kind,
        'stateCode', sr.state_code,
        'countyName', sr.county_name,
        'postalCode', sr.postal_code,
        'normalizedKey', sr.normalized_key
      ) order by sr.state_code, sr.county_name nulls last, sr.postal_code nulls last
    ), '[]'::pg_catalog.jsonb)
  into v_regions
  from domain.contractor_service_regions csr
  join domain.service_regions sr on sr.id = csr.service_region_id
  where csr.contractor_company_id = v_company_id;

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'isoWeekday', ca.iso_weekday,
        'maxJobs', ca.max_jobs,
        'urgentEnabled', ca.urgent_enabled
      ) order by ca.iso_weekday
    ), '[]'::pg_catalog.jsonb)
  into v_availability
  from domain.contractor_availability ca
  where ca.contractor_company_id = v_company_id;

  select cpb.id, cpb.version into v_price_book_id, v_price_book_version
  from domain.contractor_price_books cpb
  where cpb.contractor_company_id = v_company_id and cpb.active
  order by cpb.version desc
  limit 1;

  if v_price_book_id is not null then
    select pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'tankTier', cpr.tank_tier,
          'timingKind', cpr.timing_kind,
          'grossCents', cpr.contractor_gross_cents,
          'serviceRegionId', cpr.service_region_id
        ) order by cpr.tank_tier::text, cpr.timing_kind::text
      ), '[]'::pg_catalog.jsonb)
    into v_prices
    from domain.contractor_price_rules cpr
    where cpr.price_book_id = v_price_book_id;
  end if;

  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'type', cv.verification_type,
        'status', cv.status,
        'reference', cv.reference,
        'verifiedAt', cv.verified_at,
        'createdAt', cv.created_at
      ) order by cv.created_at desc
    ), '[]'::pg_catalog.jsonb)
  into v_verifications
  from domain.contractor_verifications cv
  where cv.contractor_company_id = v_company_id;

  return pg_catalog.jsonb_build_object(
    'exists', true,
    'company', pg_catalog.jsonb_build_object(
      'id', v_company.id,
      'legalName', v_company.legal_name,
      'displayName', v_company.display_name,
      'primaryContactName', v_company.primary_contact_name,
      'email', v_company.email,
      'phone', v_company.phone,
      'operatingAddress', v_company.operating_address,
      'status', v_company.status,
      'stripeReady', (v_company.stripe_details_submitted and v_company.stripe_charges_enabled and v_company.stripe_payouts_enabled)
    ),
    'membership', pg_catalog.jsonb_build_object('role', v_role, 'active', v_user_active),
    'regions', v_regions,
    'availability', v_availability,
    'priceBookVersion', v_price_book_version,
    'prices', v_prices,
    'verifications', v_verifications
  );
end
$function$;

create or replace function api.contractor_onboarding_save(
  p_company jsonb,
  p_regions jsonb,
  p_availability jsonb,
  p_prices jsonb,
  p_license_reference text default null,
  p_insurance_reference text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := identity.uid();
  v_email text := pg_catalog.lower(pg_catalog.coalesce(identity.jwt() ->> 'email', ''));
  v_memberships integer;
  v_company_id uuid;
  v_role text;
  v_user_active boolean;
  v_legal_name text;
  v_display_name text;
  v_contact_name text;
  v_phone text;
  v_operating_address text;
  v_item jsonb;
  v_kind text;
  v_state text;
  v_postal text;
  v_county text;
  v_region_key text;
  v_region_id uuid;
  v_weekday integer;
  v_max_jobs integer;
  v_urgent boolean;
  v_working_days integer := 0;
  v_price_count integer;
  v_distinct_tiers integer;
  v_tier text;
  v_scheduled_cents integer;
  v_urgent_cents integer;
  v_price_book_id uuid;
  v_next_version integer;
  v_license text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_license_reference, '')), '');
  v_insurance text := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_insurance_reference, '')), '');
  v_existing_audit uuid;
begin
  if v_uid is null or v_email = '' then
    raise exception using errcode = '42501', message = 'VERIFIED_EMAIL_REQUIRED';
  end if;
  if pg_catalog.length(pg_catalog.coalesce(p_idempotency_key, '')) < 8
     or pg_catalog.length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if pg_catalog.coalesce(pg_catalog.jsonb_typeof(p_company), '') <> 'object'
     or pg_catalog.coalesce(pg_catalog.jsonb_typeof(p_regions), '') <> 'array'
     or pg_catalog.coalesce(pg_catalog.jsonb_typeof(p_availability), '') <> 'array'
     or pg_catalog.coalesce(pg_catalog.jsonb_typeof(p_prices), '') <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_ONBOARDING_PAYLOAD';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':' || p_idempotency_key, 0));
  select ar.id into v_existing_audit
  from domain.audit_records ar
  where ar.actor_user_id = v_uid
    and ar.action = 'CONTRACTOR_ONBOARDING_SAVED'
    and ar.metadata ->> 'idempotencyKey' = p_idempotency_key
  order by ar.created_at desc
  limit 1;
  if v_existing_audit is not null then
    return api.contractor_onboarding_get();
  end if;

  v_legal_name := pg_catalog.btrim(pg_catalog.coalesce(p_company ->> 'legalName', ''));
  v_display_name := pg_catalog.btrim(pg_catalog.coalesce(p_company ->> 'displayName', ''));
  v_contact_name := pg_catalog.btrim(pg_catalog.coalesce(p_company ->> 'primaryContactName', ''));
  v_phone := pg_catalog.btrim(pg_catalog.coalesce(p_company ->> 'phone', ''));
  v_operating_address := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_company ->> 'operatingAddress', '')), '');

  if pg_catalog.length(v_legal_name) not between 2 and 160
     or pg_catalog.length(v_display_name) not between 2 and 120
     or pg_catalog.length(v_contact_name) not between 2 and 120
     or pg_catalog.length(v_phone) not between 7 and 30
     or pg_catalog.length(pg_catalog.coalesce(v_operating_address, '')) > 240 then
    raise exception using errcode = '22023', message = 'INVALID_COMPANY_PROFILE';
  end if;

  select pg_catalog.count(*)::integer into v_memberships
  from domain.contractor_users cu where cu.auth_user_id = v_uid;
  if v_memberships > 1 then
    raise exception using errcode = 'P0001', message = 'MULTIPLE_CONTRACTOR_COMPANIES_UNSUPPORTED';
  elsif v_memberships = 1 then
    select cu.contractor_company_id, cu.role, cu.active
    into v_company_id, v_role, v_user_active
    from domain.contractor_users cu where cu.auth_user_id = v_uid;
    if not v_user_active then
      raise exception using errcode = '42501', message = 'CONTRACTOR_MEMBERSHIP_DISABLED';
    end if;
    if v_role <> 'OWNER' then
      raise exception using errcode = '42501', message = 'CONTRACTOR_OWNER_REQUIRED';
    end if;
    update domain.contractor_companies
      set legal_name = v_legal_name,
          display_name = v_display_name,
          primary_contact_name = v_contact_name,
          email = v_email,
          phone = v_phone,
          operating_address = v_operating_address,
          updated_at = pg_catalog.now()
      where id = v_company_id;
  else
    insert into domain.contractor_companies(
      legal_name, display_name, primary_contact_name, email, phone, operating_address, status
    ) values (
      v_legal_name, v_display_name, v_contact_name, v_email, v_phone, v_operating_address, 'PENDING'
    ) returning id into v_company_id;
    insert into domain.contractor_users(contractor_company_id, auth_user_id, role, active)
      values (v_company_id, v_uid, 'OWNER', true);
  end if;

  if pg_catalog.jsonb_array_length(p_regions) < 1 or pg_catalog.jsonb_array_length(p_regions) > 40 then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE_REGION_COUNT';
  end if;
  delete from domain.contractor_service_regions csr where csr.contractor_company_id = v_company_id;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_regions)
  loop
    v_kind := pg_catalog.upper(pg_catalog.btrim(pg_catalog.coalesce(v_item ->> 'kind', '')));
    v_state := pg_catalog.upper(pg_catalog.btrim(pg_catalog.coalesce(v_item ->> 'stateCode', '')));
    v_postal := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(v_item ->> 'postalCode', '')), '');
    v_county := pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(v_item ->> 'countyName', '')), '');
    if v_state !~ '^[A-Z]{2}$' then
      raise exception using errcode = '22023', message = 'INVALID_REGION_STATE';
    end if;
    if v_kind = 'ZIP' then
      if v_postal is null or v_postal !~ '^[0-9]{5}$' then
        raise exception using errcode = '22023', message = 'INVALID_REGION_ZIP';
      end if;
      v_region_key := 'ZIP:' || v_state || ':' || v_postal;
      insert into domain.service_regions(kind, state_code, county_name, postal_code, normalized_key, active)
        values ('ZIP', v_state, null, v_postal, v_region_key, true)
        on conflict (normalized_key) do update set active = true
        returning id into v_region_id;
    elsif v_kind = 'COUNTY' then
      if v_county is null or pg_catalog.length(v_county) not between 2 and 120 then
        raise exception using errcode = '22023', message = 'INVALID_REGION_COUNTY';
      end if;
      v_region_key := 'COUNTY:' || v_state || ':' || pg_catalog.upper(v_county);
      insert into domain.service_regions(kind, state_code, county_name, postal_code, normalized_key, active)
        values ('COUNTY', v_state, v_county, null, v_region_key, true)
        on conflict (normalized_key) do update set active = true, county_name = excluded.county_name
        returning id into v_region_id;
    else
      raise exception using errcode = '22023', message = 'INVALID_REGION_KIND';
    end if;
    insert into domain.contractor_service_regions(contractor_company_id, service_region_id)
      values (v_company_id, v_region_id)
      on conflict do nothing;
  end loop;

  if pg_catalog.jsonb_array_length(p_availability) < 1 or pg_catalog.jsonb_array_length(p_availability) > 7 then
    raise exception using errcode = '22023', message = 'INVALID_AVAILABILITY_COUNT';
  end if;
  delete from domain.contractor_availability ca where ca.contractor_company_id = v_company_id;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_availability)
  loop
    if pg_catalog.coalesce(v_item ->> 'isoWeekday', '') !~ '^[1-7]$'
       or pg_catalog.coalesce(v_item ->> 'maxJobs', '') !~ '^[0-9]{1,3}$' then
      raise exception using errcode = '22023', message = 'INVALID_AVAILABILITY_ROW';
    end if;
    v_weekday := (v_item ->> 'isoWeekday')::integer;
    v_max_jobs := (v_item ->> 'maxJobs')::integer;
    v_urgent := pg_catalog.coalesce((v_item ->> 'urgentEnabled')::boolean, false);
    if v_max_jobs not between 0 and 100 then
      raise exception using errcode = '22023', message = 'INVALID_DAILY_CAPACITY';
    end if;
    insert into domain.contractor_availability(contractor_company_id, iso_weekday, max_jobs, urgent_enabled)
      values (v_company_id, v_weekday, v_max_jobs, v_urgent);
    if v_max_jobs > 0 then v_working_days := v_working_days + 1; end if;
  end loop;
  if v_working_days = 0 then
    raise exception using errcode = '22023', message = 'AT_LEAST_ONE_WORKING_DAY_REQUIRED';
  end if;

  select pg_catalog.jsonb_array_length(p_prices),
         pg_catalog.count(distinct price_row.value ->> 'tankTier')::integer
    into v_price_count, v_distinct_tiers
  from pg_catalog.jsonb_array_elements(p_prices) as price_row(value);
  if v_price_count <> 4 or v_distinct_tiers <> 4 then
    raise exception using errcode = '22023', message = 'FOUR_UNIQUE_TANK_PRICES_REQUIRED';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_prices)
  loop
    v_tier := pg_catalog.coalesce(v_item ->> 'tankTier', '');
    if v_tier not in ('GAL_750','GAL_1000','GAL_1250','GAL_1500')
       or pg_catalog.coalesce(v_item ->> 'scheduledCents', '') !~ '^[0-9]{1,9}$'
       or pg_catalog.coalesce(v_item ->> 'urgentCents', '') !~ '^[0-9]{1,9}$' then
      raise exception using errcode = '22023', message = 'INVALID_PRICE_ROW';
    end if;
    v_scheduled_cents := (v_item ->> 'scheduledCents')::integer;
    v_urgent_cents := (v_item ->> 'urgentCents')::integer;
    if v_scheduled_cents < 100 or v_scheduled_cents > 10000000
       or v_urgent_cents < v_scheduled_cents or v_urgent_cents > 10000000 then
      raise exception using errcode = '22023', message = 'INVALID_CONTRACTOR_PRICE';
    end if;
  end loop;

  select pg_catalog.coalesce(pg_catalog.max(cpb.version), 0) + 1 into v_next_version
  from domain.contractor_price_books cpb
  where cpb.contractor_company_id = v_company_id;
  update domain.contractor_price_books set active = false
    where contractor_company_id = v_company_id and active;
  insert into domain.contractor_price_books(contractor_company_id, version, active, effective_at)
    values (v_company_id, v_next_version, true, pg_catalog.now())
    returning id into v_price_book_id;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_prices)
  loop
    v_tier := v_item ->> 'tankTier';
    v_scheduled_cents := (v_item ->> 'scheduledCents')::integer;
    v_urgent_cents := (v_item ->> 'urgentCents')::integer;
    insert into domain.contractor_price_rules(price_book_id, service_region_id, tank_tier, timing_kind, contractor_gross_cents)
      values
        (v_price_book_id, null, v_tier::domain.tank_tier, 'SCHEDULED', v_scheduled_cents),
        (v_price_book_id, null, v_tier::domain.tank_tier, 'EARLIEST', v_scheduled_cents),
        (v_price_book_id, null, v_tier::domain.tank_tier, 'URGENT', v_urgent_cents);
  end loop;

  if v_license is not null and pg_catalog.length(v_license) > 160 then
    raise exception using errcode = '22023', message = 'LICENSE_REFERENCE_TOO_LONG';
  end if;
  if v_insurance is not null and pg_catalog.length(v_insurance) > 160 then
    raise exception using errcode = '22023', message = 'INSURANCE_REFERENCE_TOO_LONG';
  end if;
  if v_license is not null and not exists (
    select 1 from domain.contractor_verifications cv
    where cv.contractor_company_id = v_company_id
      and cv.verification_type = 'LICENSE_OR_PERMIT'
      and cv.reference = v_license
  ) then
    insert into domain.contractor_verifications(contractor_company_id, verification_type, status, reference, notes)
      values (v_company_id, 'LICENSE_OR_PERMIT', 'SUBMITTED', v_license, 'Contractor self-submitted; requires manual review.');
  end if;
  if v_insurance is not null and not exists (
    select 1 from domain.contractor_verifications cv
    where cv.contractor_company_id = v_company_id
      and cv.verification_type = 'INSURANCE'
      and cv.reference = v_insurance
  ) then
    insert into domain.contractor_verifications(contractor_company_id, verification_type, status, reference, notes)
      values (v_company_id, 'INSURANCE', 'SUBMITTED', v_insurance, 'Contractor self-submitted; requires manual review.');
  end if;

  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, metadata)
    values (
      v_uid,
      'CONTRACTOR',
      'CONTRACTOR_ONBOARDING_SAVED',
      'contractor_company',
      v_company_id,
      pg_catalog.jsonb_build_object(
        'idempotencyKey', p_idempotency_key,
        'priceBookVersion', v_next_version,
        'regionCount', pg_catalog.jsonb_array_length(p_regions),
        'availabilityCount', pg_catalog.jsonb_array_length(p_availability)
      )
    );

  return api.contractor_onboarding_get();
end
$function$;

alter function api.contractor_onboarding_get() owner to drainly_routine_owner;
alter function api.contractor_onboarding_save(jsonb,jsonb,jsonb,jsonb,text,text,text) owner to drainly_routine_owner;

revoke create on schema api from drainly_routine_owner;
grant usage on schema api to drainly_routine_owner;
revoke all on function api.contractor_onboarding_get() from public, anon;
revoke all on function api.contractor_onboarding_save(jsonb,jsonb,jsonb,jsonb,text,text,text) from public, anon;
grant execute on function api.contractor_onboarding_get() to authenticated;
grant execute on function api.contractor_onboarding_save(jsonb,jsonb,jsonb,jsonb,text,text,text) to authenticated;
