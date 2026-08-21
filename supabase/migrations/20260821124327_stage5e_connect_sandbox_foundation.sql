begin;

alter table domain.contractor_companies
  add column if not exists stripe_connect_environment text not null default 'UNCONNECTED',
  add column if not exists stripe_transfer_capability_status text,
  add column if not exists stripe_connect_ready boolean not null default false,
  add column if not exists stripe_connect_synced_at timestamptz;

alter table domain.contractor_companies
  drop constraint if exists contractor_companies_stripe_connect_environment_check;

alter table domain.contractor_companies
  add constraint contractor_companies_stripe_connect_environment_check
  check (stripe_connect_environment in ('UNCONNECTED', 'SANDBOX'));

create or replace function internal.get_contractor_connect_context(p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_count integer;
  v_company_id uuid;
  v_role text;
  v_active boolean;
  v_company domain.contractor_companies%rowtype;
begin
  if p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'AUTH_USER_ID_REQUIRED';
  end if;

  select pg_catalog.count(*)::integer into v_count
  from domain.contractor_users cu
  where cu.auth_user_id = p_auth_user_id;

  if v_count = 0 then
    return pg_catalog.jsonb_build_object('exists', false);
  elsif v_count > 1 then
    raise exception using errcode = 'P0001', message = 'MULTIPLE_CONTRACTOR_COMPANIES_UNSUPPORTED';
  end if;

  select cu.contractor_company_id, cu.role, cu.active
  into v_company_id, v_role, v_active
  from domain.contractor_users cu
  where cu.auth_user_id = p_auth_user_id;

  if not v_active or v_role <> 'OWNER' then
    raise exception using errcode = '42501', message = 'CONTRACTOR_OWNER_REQUIRED';
  end if;

  select * into strict v_company
  from domain.contractor_companies cc
  where cc.id = v_company_id;

  return pg_catalog.jsonb_build_object(
    'exists', true,
    'companyId', v_company.id,
    'displayName', v_company.display_name,
    'email', v_company.email,
    'status', v_company.status,
    'stripeAccountId', v_company.stripe_connected_account_id,
    'connectEnvironment', v_company.stripe_connect_environment,
    'transferCapabilityStatus', v_company.stripe_transfer_capability_status,
    'connectReady', v_company.stripe_connect_ready,
    'syncedAt', v_company.stripe_connect_synced_at
  );
end
$function$;

create or replace function internal.bind_contractor_connect_account(
  p_auth_user_id uuid,
  p_stripe_account_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_existing_account_id text;
begin
  if p_auth_user_id is null
     or p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then
    raise exception using errcode = '22023', message = 'INVALID_CONNECT_BINDING';
  end if;

  select cu.contractor_company_id into v_company_id
  from domain.contractor_users cu
  where cu.auth_user_id = p_auth_user_id
    and cu.active
    and cu.role = 'OWNER';

  if v_company_id is null then
    raise exception using errcode = '42501', message = 'CONTRACTOR_OWNER_REQUIRED';
  end if;

  select cc.stripe_connected_account_id into v_existing_account_id
  from domain.contractor_companies cc
  where cc.id = v_company_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'CONTRACTOR_COMPANY_NOT_FOUND';
  end if;

  if v_existing_account_id is not null and v_existing_account_id <> p_stripe_account_id then
    raise exception using errcode = '23505', message = 'DIFFERENT_CONNECT_ACCOUNT_ALREADY_BOUND';
  end if;

  update domain.contractor_companies
  set stripe_connected_account_id = p_stripe_account_id,
      stripe_connect_environment = 'SANDBOX',
      stripe_connect_ready = false,
      stripe_connect_synced_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = v_company_id;

  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, metadata)
  values (
    p_auth_user_id,
    'CONTRACTOR',
    'STRIPE_CONNECT_ACCOUNT_BOUND',
    'contractor_company',
    v_company_id,
    pg_catalog.jsonb_build_object('environment', 'SANDBOX', 'stripeAccountId', p_stripe_account_id)
  );

  return pg_catalog.jsonb_build_object(
    'companyId', v_company_id,
    'stripeAccountId', p_stripe_account_id,
    'connectEnvironment', 'SANDBOX'
  );
end
$function$;

create or replace function internal.record_contractor_connect_status(
  p_auth_user_id uuid,
  p_stripe_account_id text,
  p_transfer_capability_status text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_ready boolean;
begin
  if p_auth_user_id is null
     or p_stripe_account_id is null
     or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_transfer_capability_status is null
     or pg_catalog.length(p_transfer_capability_status) not between 2 and 64 then
    raise exception using errcode = '22023', message = 'INVALID_CONNECT_STATUS';
  end if;

  select cu.contractor_company_id into v_company_id
  from domain.contractor_users cu
  where cu.auth_user_id = p_auth_user_id
    and cu.active
    and cu.role = 'OWNER';

  if v_company_id is null then
    raise exception using errcode = '42501', message = 'CONTRACTOR_OWNER_REQUIRED';
  end if;

  v_ready := p_transfer_capability_status = 'active';

  update domain.contractor_companies
  set stripe_transfer_capability_status = p_transfer_capability_status,
      stripe_connect_ready = v_ready,
      stripe_connect_synced_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = v_company_id
    and stripe_connected_account_id = p_stripe_account_id
    and stripe_connect_environment = 'SANDBOX';

  if not found then
    raise exception using errcode = 'P0001', message = 'CONNECT_ACCOUNT_NOT_BOUND_TO_CONTRACTOR';
  end if;

  return pg_catalog.jsonb_build_object(
    'companyId', v_company_id,
    'stripeAccountId', p_stripe_account_id,
    'transferCapabilityStatus', p_transfer_capability_status,
    'connectReady', v_ready,
    'syncedAt', pg_catalog.now()
  );
end
$function$;

grant create on schema internal to drainly_routine_owner;
alter function internal.get_contractor_connect_context(uuid) owner to drainly_routine_owner;
alter function internal.bind_contractor_connect_account(uuid, text) owner to drainly_routine_owner;
alter function internal.record_contractor_connect_status(uuid, text, text) owner to drainly_routine_owner;
revoke create on schema internal from drainly_routine_owner;

revoke all on function internal.get_contractor_connect_context(uuid) from public, anon, authenticated;
revoke all on function internal.bind_contractor_connect_account(uuid, text) from public, anon, authenticated;
revoke all on function internal.record_contractor_connect_status(uuid, text, text) from public, anon, authenticated;

grant execute on function internal.get_contractor_connect_context(uuid) to drainly_system;
grant execute on function internal.bind_contractor_connect_account(uuid, text) to drainly_system;
grant execute on function internal.record_contractor_connect_status(uuid, text, text) to drainly_system;

commit;
