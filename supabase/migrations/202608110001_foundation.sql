begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create schema if not exists api authorization postgres;
create schema if not exists domain authorization postgres;
create schema if not exists internal authorization postgres;
create schema if not exists identity authorization postgres;

revoke all on schema api, domain, internal, identity from public;
grant usage on schema api to anon, authenticated;
alter default privileges in schema api revoke all on tables from public;
alter default privileges in schema api revoke all on sequences from public;
alter default privileges in schema api revoke all on functions from public;
alter default privileges in schema domain revoke all on tables from public;
alter default privileges in schema domain revoke all on sequences from public;
alter default privileges in schema domain revoke all on functions from public;
alter default privileges in schema internal revoke all on tables from public;
alter default privileges in schema internal revoke all on sequences from public;
alter default privileges in schema internal revoke all on functions from public;

do $roles$
declare
  role_state pg_catalog.pg_roles%rowtype;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'drainly_system') then
    create role drainly_system login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'drainly_routine_owner') then
    create role drainly_routine_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;

  select * into strict role_state
  from pg_catalog.pg_roles
  where rolname = 'drainly_system';

  if role_state.rolsuper
    or role_state.rolcreatedb
    or role_state.rolcreaterole
    or role_state.rolreplication
    or role_state.rolbypassrls
    or not role_state.rolcanlogin
  then
    raise exception 'Unsafe role attributes for drainly_system'
      using detail = pg_catalog.format(
        'LOGIN=%s SUPERUSER=%s CREATEDB=%s CREATEROLE=%s REPLICATION=%s BYPASSRLS=%s. Repair this cluster-level role before running Drainly migrations.',
        role_state.rolcanlogin,
        role_state.rolsuper,
        role_state.rolcreatedb,
        role_state.rolcreaterole,
        role_state.rolreplication,
        role_state.rolbypassrls
      );
  end if;

  select * into strict role_state
  from pg_catalog.pg_roles
  where rolname = 'drainly_routine_owner';

  if role_state.rolsuper
    or role_state.rolcreatedb
    or role_state.rolcreaterole
    or role_state.rolreplication
    or role_state.rolbypassrls
    or role_state.rolcanlogin
  then
    raise exception 'Unsafe role attributes for drainly_routine_owner'
      using detail = pg_catalog.format(
        'LOGIN=%s SUPERUSER=%s CREATEDB=%s CREATEROLE=%s REPLICATION=%s BYPASSRLS=%s. Repair this cluster-level role before running Drainly migrations.',
        role_state.rolcanlogin,
        role_state.rolsuper,
        role_state.rolcreatedb,
        role_state.rolcreaterole,
        role_state.rolreplication,
        role_state.rolbypassrls
      );
  end if;
end
$roles$;

grant usage on schema domain, internal to drainly_routine_owner;
grant usage on schema identity to drainly_routine_owner;
grant usage on schema extensions to drainly_routine_owner;
grant execute on function extensions.gen_random_uuid() to drainly_routine_owner;
grant usage on schema internal to drainly_system;

create function identity.uid() returns uuid
language sql stable security definer
set search_path = ''
as $function$
  select auth.uid()
$function$;

create function identity.jwt() returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select auth.jwt()
$function$;

revoke all on function identity.uid(), identity.jwt() from public;
grant execute on function identity.uid(), identity.jwt() to drainly_routine_owner;

create type domain.contractor_status as enum ('PENDING', 'APPROVED', 'DISABLED');
create type domain.region_kind as enum ('COUNTY', 'ZIP');
create type domain.tank_tier as enum ('GAL_750', 'GAL_1000', 'GAL_1250', 'GAL_1500', 'UNKNOWN');
create type domain.timing_kind as enum ('SCHEDULED', 'EARLIEST', 'URGENT');
create type domain.access_type as enum ('ATTENDED', 'UNATTENDED');
create type domain.quote_status as enum ('PRICED', 'REVIEW_REQUIRED', 'UNAVAILABLE', 'UNSUPPORTED', 'EXPIRED', 'CONVERTED');
create type domain.order_status as enum ('SEARCHING_CONTRACTOR', 'SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'SERVICE_COMPLETED', 'CLOSED', 'CANCELLED', 'FAILED_ACCESS', 'FAILED_SERVICE', 'REASSIGNMENT_PENDING', 'NEEDS_ADMIN_REVIEW');
create type domain.offer_status as enum ('OPEN', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');
create type domain.payment_generation_status as enum ('REQUESTED', 'AUTHORIZATION_SCHEDULED', 'AUTHORIZATION_PENDING', 'AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED', 'ACTION_REQUIRED', 'FAILED', 'CANCELLATION_PENDING', 'CANCELLED', 'SUPERSEDED');
create type domain.refund_status as enum ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED');
create type domain.proof_status as enum ('PENDING', 'VERIFIED', 'REJECTED');
create type domain.notification_status as enum ('PENDING', 'SENDING', 'SENT', 'FAILED');
create type domain.work_status as enum ('PENDING', 'LEASED', 'COMPLETED', 'FAILED');
create type domain.ledger_entry_type as enum ('CAPTURE', 'CUSTOMER_REFUND', 'CONTRACTOR_TRANSFER', 'TRANSFER_REVERSAL', 'STRIPE_PROCESSING_FEE', 'DISPUTE_FEE', 'OTHER_PROVIDER_FEE');

create table domain.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null,
  phone text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.contractor_companies (
  id uuid primary key default extensions.gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  primary_contact_name text not null,
  email text not null,
  phone text not null,
  operating_address text,
  status domain.contractor_status not null default 'PENDING',
  priority integer not null default 100 check (priority between 0 and 10000),
  stripe_connected_account_id text unique,
  stripe_details_submitted boolean not null default false,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  internal_notes text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.contractor_users (
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'DISPATCHER' check (role in ('OWNER', 'DISPATCHER', 'TECHNICIAN')),
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (contractor_company_id, auth_user_id)
);

create table domain.platform_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'OPERATIONS' check (role in ('OPERATIONS', 'FINANCE', 'SUPER_ADMIN')),
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now()
);

create table domain.contractor_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  verification_type text not null,
  status text not null check (status in ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED')),
  reference text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default pg_catalog.now()
);

create table domain.service_regions (
  id uuid primary key default extensions.gen_random_uuid(),
  kind domain.region_kind not null,
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  county_name text,
  postal_code text,
  normalized_key text not null unique,
  active boolean not null default true,
  check ((kind = 'COUNTY' and county_name is not null and postal_code is null) or (kind = 'ZIP' and postal_code is not null))
);

create table domain.contractor_service_regions (
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  service_region_id uuid not null references domain.service_regions(id) on delete cascade,
  primary key (contractor_company_id, service_region_id)
);

create table domain.contractor_availability (
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  max_jobs integer not null check (max_jobs between 0 and 100),
  urgent_enabled boolean not null default false,
  primary key (contractor_company_id, iso_weekday)
);

create table domain.contractor_blackout_dates (
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  blackout_date date not null,
  reason text,
  primary key (contractor_company_id, blackout_date)
);

create table domain.contractor_day_capacity (
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  service_date date not null,
  max_jobs_snapshot integer not null check (max_jobs_snapshot between 0 and 100),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (contractor_company_id, service_date)
);

create table domain.marketplace_settings (
  id uuid primary key default extensions.gen_random_uuid(),
  version integer not null unique check (version > 0),
  active boolean not null default false,
  authorization_lead_time_minutes integer not null default 2880 check (authorization_lead_time_minutes between 0 and 43200),
  estimated_processing_rate_bps integer not null check (estimated_processing_rate_bps between 0 and 10000),
  estimated_processing_fixed_cents integer not null check (estimated_processing_fixed_cents between 0 and 100000),
  minimum_contribution_margin_cents integer not null check (minimum_contribution_margin_cents between -100000 and 1000000),
  default_contractor_fee_bps integer not null check (default_contractor_fee_bps between 0 and 10000),
  default_contractor_fixed_fee_cents integer not null default 0 check (default_contractor_fixed_fee_cents between 0 and 100000),
  quote_ttl_minutes integer not null default 30 check (quote_ttl_minutes between 5 and 1440),
  scheduled_offer_ttl_minutes integer not null default 30 check (scheduled_offer_ttl_minutes between 1 and 1440),
  urgent_offer_ttl_minutes integer not null default 10 check (urgent_offer_ttl_minutes between 1 and 120),
  created_at timestamptz not null default pg_catalog.now()
);
create unique index marketplace_settings_one_active_idx on domain.marketplace_settings ((true)) where active;

create table domain.regional_price_books (
  id uuid primary key default extensions.gen_random_uuid(),
  version integer not null unique check (version > 0),
  active boolean not null default false,
  effective_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now()
);
create unique index regional_price_books_one_active_idx on domain.regional_price_books ((true)) where active;

create table domain.regional_price_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  price_book_id uuid not null references domain.regional_price_books(id) on delete cascade,
  service_region_id uuid not null references domain.service_regions(id) on delete restrict,
  tank_tier domain.tank_tier not null check (tank_tier <> 'UNKNOWN'),
  timing_kind domain.timing_kind not null,
  customer_subtotal_cents integer not null check (customer_subtotal_cents > 0),
  customer_fee_cents integer not null default 0 check (customer_fee_cents >= 0),
  unique (price_book_id, service_region_id, tank_tier, timing_kind)
);

create table domain.contractor_price_books (
  id uuid primary key default extensions.gen_random_uuid(),
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete cascade,
  version integer not null check (version > 0),
  active boolean not null default false,
  effective_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  unique (contractor_company_id, version)
);
create unique index contractor_price_books_one_active_idx on domain.contractor_price_books (contractor_company_id) where active;

create table domain.contractor_price_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  price_book_id uuid not null references domain.contractor_price_books(id) on delete cascade,
  service_region_id uuid references domain.service_regions(id) on delete restrict,
  tank_tier domain.tank_tier not null check (tank_tier <> 'UNKNOWN'),
  timing_kind domain.timing_kind not null,
  contractor_gross_cents integer not null check (contractor_gross_cents > 0),
  unique nulls not distinct (price_book_id, service_region_id, tank_tier, timing_kind)
);

create table domain.contractor_fee_configs (
  contractor_company_id uuid primary key references domain.contractor_companies(id) on delete cascade,
  fee_bps integer check (fee_bps between 0 and 10000),
  fixed_fee_cents integer check (fixed_fee_cents between 0 and 100000),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.properties (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references domain.customers(id) on delete cascade,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state_code text not null,
  postal_code text not null,
  county_name text not null,
  normalized_address text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  known_tank_tier domain.tank_tier,
  default_access_instructions text,
  septic_notes text,
  last_pumped_on date,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  idempotency_key text not null unique default extensions.gen_random_uuid()::text,
  customer_id uuid references domain.customers(id) on delete set null,
  status domain.quote_status not null,
  service_region_id uuid references domain.service_regions(id) on delete restrict,
  tank_tier domain.tank_tier not null,
  timing_kind domain.timing_kind not null,
  access_type domain.access_type not null,
  requested_service_date date not null,
  service_window_start_at timestamptz not null,
  address_snapshot jsonb not null,
  service_notes text,
  regional_price_book_version integer,
  marketplace_settings_version integer,
  customer_subtotal_cents integer,
  customer_fee_cents integer,
  customer_total_cents integer,
  estimated_payment_processing_cost_cents integer,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  converted_at timestamptz,
  check (customer_subtotal_cents is null or customer_subtotal_cents >= 0),
  check (customer_fee_cents is null or customer_fee_cents >= 0),
  check (customer_total_cents is null or customer_total_cents = customer_subtotal_cents + customer_fee_cents)
);

create table domain.quote_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_id uuid not null references domain.quotes(id) on delete cascade,
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete restrict,
  rank integer not null check (rank > 0),
  contractor_price_book_version integer not null,
  contractor_gross_cents integer not null check (contractor_gross_cents > 0),
  contractor_marketplace_fee_cents integer not null check (contractor_marketplace_fee_cents >= 0),
  contractor_payout_cents integer not null check (contractor_payout_cents >= 0),
  stripe_transfer_amount_cents integer not null check (stripe_transfer_amount_cents >= 0),
  platform_gross_retained_cents integer not null,
  platform_pricing_adjustment_cents integer not null,
  estimated_payment_processing_cost_cents integer not null check (estimated_payment_processing_cost_cents >= 0),
  expected_platform_net_contribution_cents integer not null,
  meets_guardrail boolean not null,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  unique (quote_id, contractor_company_id),
  check (stripe_transfer_amount_cents = contractor_payout_cents)
);

create table domain.quote_economics_overrides (
  quote_id uuid primary key references domain.quotes(id) on delete restrict,
  minimum_contribution_margin_cents integer not null,
  reason text not null,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default pg_catalog.now()
);

create table domain.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  public_ref text not null unique default ('DRN-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_id uuid not null references domain.customers(id) on delete restrict,
  property_id uuid not null references domain.properties(id) on delete restrict,
  quote_id uuid not null unique references domain.quotes(id) on delete restrict,
  status domain.order_status not null default 'SEARCHING_CONTRACTOR',
  tank_tier domain.tank_tier not null,
  timing_kind domain.timing_kind not null,
  access_type domain.access_type not null,
  requested_service_date date not null,
  service_window_start_at timestamptz not null,
  address_snapshot jsonb not null,
  service_notes text,
  customer_subtotal_cents integer not null check (customer_subtotal_cents >= 0),
  customer_fee_cents integer not null check (customer_fee_cents >= 0),
  customer_total_cents integer not null check (customer_total_cents = customer_subtotal_cents + customer_fee_cents),
  marketplace_settings_version integer not null,
  regional_price_book_version integer not null,
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_setup_intent_id text,
  pending_contractor_company_id uuid references domain.contractor_companies(id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.order_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete cascade,
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete restrict,
  dispatch_round integer not null default 1 check (dispatch_round > 0),
  status domain.offer_status not null default 'OPEN',
  offered_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  contractor_price_book_version integer not null,
  marketplace_settings_version integer not null,
  estimated_processing_rate_bps integer not null check (estimated_processing_rate_bps between 0 and 10000),
  estimated_processing_fixed_cents integer not null check (estimated_processing_fixed_cents >= 0),
  minimum_contribution_margin_cents_applied integer not null,
  contractor_gross_cents integer not null,
  contractor_marketplace_fee_cents integer not null,
  contractor_payout_cents integer not null,
  platform_pricing_adjustment_cents integer not null,
  estimated_payment_processing_cost_cents integer not null,
  expected_platform_net_contribution_cents integer not null,
  unique (order_id, contractor_company_id, dispatch_round),
  check (contractor_payout_cents >= 0)
);
create unique index order_offers_one_accepted_idx on domain.order_offers (order_id) where status = 'ACCEPTED';

create table domain.order_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete restrict,
  contractor_company_id uuid not null references domain.contractor_companies(id) on delete restrict,
  offer_id uuid unique references domain.order_offers(id) on delete restrict,
  assigned_at timestamptz not null default pg_catalog.now(),
  released_at timestamptz,
  release_reason text
);
create unique index order_assignments_one_active_idx on domain.order_assignments (order_id) where released_at is null;

create table domain.payment_generations (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete restrict,
  assignment_id uuid not null unique references domain.order_assignments(id) on delete restrict,
  generation_number integer not null check (generation_number > 0),
  is_current boolean not null default true,
  status domain.payment_generation_status not null,
  connected_account_id text not null,
  contractor_price_book_version integer not null,
  marketplace_settings_version integer not null,
  estimated_processing_rate_bps integer not null check (estimated_processing_rate_bps between 0 and 10000),
  estimated_processing_fixed_cents integer not null check (estimated_processing_fixed_cents >= 0),
  minimum_contribution_margin_cents_applied integer not null,
  customer_total_cents integer not null check (customer_total_cents >= 0),
  contractor_gross_cents integer not null check (contractor_gross_cents >= 0),
  contractor_marketplace_fee_cents integer not null check (contractor_marketplace_fee_cents >= 0),
  contractor_payout_cents integer not null check (contractor_payout_cents >= 0),
  stripe_transfer_amount_cents integer not null check (stripe_transfer_amount_cents >= 0),
  platform_gross_retained_cents integer not null,
  platform_pricing_adjustment_cents integer not null,
  estimated_payment_processing_cost_cents integer not null check (estimated_payment_processing_cost_cents >= 0),
  expected_platform_net_contribution_cents integer not null,
  stripe_processing_fee_cents integer,
  actual_platform_net_transaction_cents integer,
  provider_payment_intent_id text unique,
  capture_before timestamptz,
  authorization_target_at timestamptz not null,
  authorization_override boolean not null default false,
  authorization_override_reason text,
  predecessor_generation_id uuid references domain.payment_generations(id) on delete restrict,
  failure_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (order_id, generation_number),
  check (contractor_payout_cents <= customer_total_cents),
  check (stripe_transfer_amount_cents = contractor_payout_cents),
  check (platform_gross_retained_cents = customer_total_cents - contractor_payout_cents)
);
create unique index payment_generations_one_current_idx on domain.payment_generations (order_id) where is_current;

create table domain.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete restrict,
  payment_generation_id uuid not null references domain.payment_generations(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  status domain.refund_status not null default 'REQUESTED',
  reason text not null,
  idempotency_key text not null unique,
  provider_refund_id text unique,
  transfer_reversal_cents integer,
  unrecovered_contractor_funds_cents integer check (unrecovered_contractor_funds_cents is null or unrecovered_contractor_funds_cents >= 0),
  failure_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table domain.financial_ledger_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete restrict,
  payment_generation_id uuid references domain.payment_generations(id) on delete restrict,
  refund_id uuid references domain.refunds(id) on delete restrict,
  entry_type domain.ledger_entry_type not null,
  amount_cents integer not null check (amount_cents >= 0),
  provider_reference text,
  provider_event_id text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique nulls not distinct (entry_type, provider_reference, provider_event_id)
);

create table domain.order_events (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete cascade,
  event_type text not null,
  previous_status domain.order_status,
  resulting_status domain.order_status,
  actor_type text not null check (actor_type in ('CUSTOMER', 'CONTRACTOR', 'ADMIN', 'SYSTEM')),
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  unique (order_id, idempotency_key)
);

create table domain.job_proofs (
  id uuid primary key default extensions.gen_random_uuid(),
  idempotency_key text not null unique default extensions.gen_random_uuid()::text,
  order_id uuid not null references domain.orders(id) on delete cascade,
  assignment_id uuid not null references domain.order_assignments(id) on delete restrict,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  checksum_sha256 text not null,
  status domain.proof_status not null default 'PENDING',
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz,
  created_at timestamptz not null default pg_catalog.now()
);

create table domain.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid references domain.orders(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('CUSTOMER', 'CONTRACTOR', 'ADMIN')),
  channel text not null check (channel in ('EMAIL', 'SMS')),
  template_key text not null,
  idempotency_key text not null unique,
  destination_hash text not null,
  status domain.notification_status not null default 'PENDING',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  sent_at timestamptz
);

create table domain.audit_records (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create table domain.admin_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid references domain.orders(id) on delete cascade,
  contractor_company_id uuid references domain.contractor_companies(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  note text not null,
  created_at timestamptz not null default pg_catalog.now(),
  check ((order_id is not null)::integer + (contractor_company_id is not null)::integer = 1)
);

create table internal.webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null,
  provider_event_id text not null unique,
  event_type text not null,
  livemode boolean not null,
  payload_sha256 text not null,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  received_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz,
  error_message text
);

create table internal.scheduled_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  task_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  due_at timestamptz not null,
  status domain.work_status not null default 'PENDING',
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz
);

create table internal.outbox_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  topic text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  status domain.work_status not null default 'PENDING',
  available_at timestamptz not null default pg_catalog.now(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz
);

create table internal.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default pg_catalog.now()
);

create table internal.verified_setup_intents (
  setup_intent_id text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  payment_method_id text not null,
  provider_status text not null check (provider_status = 'succeeded'),
  usage text not null check (usage = 'off_session'),
  consent_version text not null,
  consent_recorded_at timestamptz not null,
  verified_at timestamptz not null default pg_catalog.now(),
  consumed_at timestamptz
);

create table internal.payment_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_generation_id uuid not null references domain.payment_generations(id) on delete restrict,
  operation text not null check (operation in ('AUTHORIZE','CANCEL','CAPTURE','REFUND')),
  idempotency_key text not null unique,
  provider_object_id text,
  status text not null check (status in ('STARTED','SUCCEEDED','PENDING','FAILED')),
  attempts integer not null default 1 check (attempts > 0),
  failure_code text,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz
);

create table internal.reconciliation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','COMPLETED','FAILED')),
  provider_cursor text,
  reconciled_count integer not null default 0 check (reconciled_count >= 0),
  discrepancy_count integer not null default 0 check (discrepancy_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  check (period_end > period_start)
);

create table internal.provider_disputes (
  provider_dispute_id text primary key,
  order_id uuid references domain.orders(id) on delete restrict,
  payment_generation_id uuid references domain.payment_generations(id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  provider_status text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create or replace function domain.reject_append_only_mutation() returns trigger
language plpgsql set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'APPEND_ONLY_TABLE';
end
$function$;
revoke all on function domain.reject_append_only_mutation() from public;
create trigger order_events_append_only before update or delete on domain.order_events
  for each row execute function domain.reject_append_only_mutation();
create trigger audit_records_append_only before update or delete on domain.audit_records
  for each row execute function domain.reject_append_only_mutation();
create trigger financial_ledger_append_only before update or delete on domain.financial_ledger_entries
  for each row execute function domain.reject_append_only_mutation();

create index orders_customer_idx on domain.orders (customer_id, created_at desc);
create index orders_service_date_idx on domain.orders (requested_service_date, status);
create index offers_contractor_status_idx on domain.order_offers (contractor_company_id, status, expires_at);
create index assignments_contractor_idx on domain.order_assignments (contractor_company_id, assigned_at desc);
create index events_order_idx on domain.order_events (order_id, created_at);
create index scheduled_tasks_due_idx on internal.scheduled_tasks (status, due_at);
create index outbox_due_idx on internal.outbox_messages (status, available_at);

-- RLS is defense in depth even though domain/internal are not exposed by PostgREST.
do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers','contractor_companies','contractor_users','platform_admins','contractor_verifications',
    'properties','quotes','quote_candidates','quote_economics_overrides','orders','order_offers','order_assignments','payment_generations',
    'refunds','financial_ledger_entries','order_events','job_proofs','notifications','audit_records','admin_notes'
  ] loop
    execute pg_catalog.format('alter table domain.%I enable row level security', table_name);
    execute pg_catalog.format('alter table domain.%I force row level security', table_name);
  end loop;
  foreach table_name in array array['webhook_events','scheduled_tasks','outbox_messages','rate_limit_buckets','verified_setup_intents','payment_attempts','reconciliation_runs','provider_disputes'] loop
    execute pg_catalog.format('alter table internal.%I enable row level security', table_name);
    execute pg_catalog.format('alter table internal.%I force row level security', table_name);
  end loop;
end
$rls$;

create policy customers_self_select on domain.customers for select to authenticated using (auth_user_id = (select identity.uid()));
create policy contractor_users_self_select on domain.contractor_users for select to authenticated using (auth_user_id = (select identity.uid()));
create policy admins_self_select on domain.platform_admins for select to authenticated using (auth_user_id = (select identity.uid()));
create policy companies_member_or_admin_select on domain.contractor_companies for select to authenticated using (
  exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy properties_customer_select on domain.properties for select to authenticated using (
  exists (select 1 from domain.customers c where c.id = customer_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy quotes_customer_select on domain.quotes for select to authenticated using (
  exists (select 1 from domain.customers c where c.id = customer_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy quote_candidates_authorized_select on domain.quote_candidates for select to authenticated using (
  exists (select 1 from domain.quotes q join domain.customers c on c.id = q.customer_id where q.id = quote_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = contractor_company_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy quote_economics_overrides_admin_select on domain.quote_economics_overrides for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy orders_actor_select on domain.orders for select to authenticated using (
  exists (select 1 from domain.customers c where c.id = customer_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id where oa.order_id = id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy offers_actor_select on domain.order_offers for select to authenticated using (
  exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = contractor_company_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy assignments_actor_select on domain.order_assignments for select to authenticated using (
  exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = contractor_company_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id = order_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy payment_actor_select on domain.payment_generations for select to authenticated using (
  exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id = order_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id where oa.id = assignment_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy events_actor_select on domain.order_events for select to authenticated using (
  exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id = order_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id where oa.order_id = order_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy proofs_actor_select on domain.job_proofs for select to authenticated using (
  exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id = order_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id where oa.id = assignment_id and cu.auth_user_id = (select identity.uid()) and cu.active)
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy refunds_admin_or_customer_select on domain.refunds for select to authenticated using (
  exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id = order_id and c.auth_user_id = (select identity.uid()))
  or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy ledger_admin_select on domain.financial_ledger_entries for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy notifications_admin_select on domain.notifications for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy audit_admin_select on domain.audit_records for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy notes_admin_select on domain.admin_notes for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);
create policy verifications_admin_select on domain.contractor_verifications for select to authenticated using (
  exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
);

-- Explicit routine-owner RLS access. The owner is not a table owner and has no login.
do $owner_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers','contractor_companies','contractor_users','platform_admins','contractor_verifications',
    'service_regions','contractor_service_regions','contractor_availability','contractor_blackout_dates','contractor_day_capacity',
    'marketplace_settings','regional_price_books','regional_price_rules','contractor_price_books','contractor_price_rules','contractor_fee_configs',
    'properties','quotes','quote_candidates','quote_economics_overrides','orders','order_offers','order_assignments','payment_generations','refunds',
    'financial_ledger_entries','order_events','job_proofs','notifications','audit_records','admin_notes'
  ] loop
    execute pg_catalog.format('grant select, insert, update on domain.%I to drainly_routine_owner', table_name);
  end loop;
  foreach table_name in array array[
    'customers','contractor_companies','contractor_users','platform_admins','contractor_verifications',
    'properties','quotes','quote_candidates','quote_economics_overrides','orders','order_offers','order_assignments','payment_generations','refunds',
    'financial_ledger_entries','order_events','job_proofs','notifications','audit_records','admin_notes'
  ] loop
    execute pg_catalog.format('create policy routine_owner_explicit_access on domain.%I for all to drainly_routine_owner using (true) with check (true)', table_name);
  end loop;
  foreach table_name in array array['webhook_events','scheduled_tasks','outbox_messages','rate_limit_buckets','verified_setup_intents','payment_attempts','reconciliation_runs','provider_disputes'] loop
    execute pg_catalog.format('grant select, insert, update on internal.%I to drainly_routine_owner', table_name);
    execute pg_catalog.format('create policy routine_owner_explicit_access on internal.%I for all to drainly_routine_owner using (true) with check (true)', table_name);
  end loop;
end
$owner_policies$;

grant select on domain.customers, domain.contractor_companies, domain.contractor_users, domain.platform_admins,
  domain.properties, domain.quotes, domain.quote_candidates, domain.quote_economics_overrides, domain.orders, domain.order_offers,
  domain.order_assignments, domain.payment_generations, domain.refunds, domain.financial_ledger_entries,
  domain.order_events, domain.job_proofs, domain.notifications, domain.audit_records, domain.admin_notes,
  domain.contractor_verifications to authenticated;

create view api.customer_orders with (security_invoker = true) as
select o.id, o.public_ref, o.status, o.tank_tier, o.timing_kind, o.access_type,
       o.requested_service_date, o.address_snapshot, o.customer_total_cents, o.created_at,
       pg.status as payment_status
from domain.orders o
left join domain.payment_generations pg on pg.order_id = o.id and pg.is_current;

create view api.contractor_offers with (security_invoker = true) as
select oo.id, oo.order_id, oo.status, oo.expires_at, oo.contractor_payout_cents,
       o.requested_service_date, o.timing_kind, o.tank_tier,
       o.address_snapshot ->> 'countyName' as county_name,
       o.address_snapshot ->> 'postalCode' as postal_code
from domain.order_offers oo
join domain.orders o on o.id = oo.order_id;

create view api.contractor_jobs with (security_invoker = true) as
select oa.id as assignment_id, o.id as order_id, o.public_ref, o.status, o.requested_service_date,
       o.service_window_start_at, o.access_type, o.tank_tier, o.address_snapshot,
       pg.status as payment_status, pg.contractor_payout_cents
from domain.order_assignments oa
join domain.orders o on o.id = oa.order_id
left join domain.payment_generations pg on pg.assignment_id = oa.id and pg.is_current
where oa.released_at is null;

create view api.admin_order_overview with (security_invoker = true) as
select o.id, o.public_ref, o.status, o.requested_service_date, o.customer_total_cents,
       oa.contractor_company_id, cc.display_name as contractor_name, pg.status as payment_status,
       pg.platform_gross_retained_cents, pg.stripe_processing_fee_cents,
       pg.actual_platform_net_transaction_cents, o.updated_at
from domain.orders o
left join domain.order_assignments oa on oa.order_id = o.id and oa.released_at is null
left join domain.contractor_companies cc on cc.id = oa.contractor_company_id
left join domain.payment_generations pg on pg.order_id = o.id and pg.is_current;

grant select on api.customer_orders, api.contractor_offers, api.contractor_jobs, api.admin_order_overview to authenticated;

-- Anonymous/authenticated trusted price calculation. All authoritative amounts come from database configuration.
create or replace function api.create_quote(
  p_region_key text,
  p_tank_tier domain.tank_tier,
  p_timing_kind domain.timing_kind,
  p_access_type domain.access_type,
  p_requested_service_date date,
  p_service_window_start_at timestamptz,
  p_address_snapshot jsonb,
  p_idempotency_key text,
  p_service_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_region domain.service_regions%rowtype;
  v_settings domain.marketplace_settings%rowtype;
  v_price record;
  v_quote_id uuid := extensions.gen_random_uuid();
  v_customer_id uuid;
  v_status domain.quote_status;
  v_total integer;
  v_estimated_fee integer;
  v_candidate_count integer := 0;
  v_viable_count integer := 0;
  v_rank integer := 0;
  v_candidate record;
  v_marketplace_fee integer;
  v_payout integer;
  v_net integer;
  v_existing domain.quotes%rowtype;
begin
  if p_requested_service_date < (pg_catalog.now() at time zone 'America/New_York')::date then
    raise exception using errcode = '22023', message = 'SERVICE_DATE_IN_PAST';
  end if;
  if pg_catalog.length(coalesce(p_service_notes, '')) > 2000 then
    raise exception using errcode = '22023', message = 'NOTES_TOO_LONG';
  end if;
  if pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select c.id into v_customer_id from domain.customers c where c.auth_user_id = identity.uid();
  select * into v_existing from domain.quotes q where q.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.customer_id is distinct from v_customer_id then
      raise exception using errcode = '42501', message = 'IDEMPOTENCY_KEY_COLLISION';
    end if;
    return pg_catalog.jsonb_build_object('quoteId', v_existing.id, 'status', v_existing.status,
      'expiresAt', v_existing.expires_at, 'customerSubtotalCents', v_existing.customer_subtotal_cents,
      'customerFeeCents', v_existing.customer_fee_cents, 'customerTotalCents', v_existing.customer_total_cents,
      'estimatedPaymentProcessingCostCents', v_existing.estimated_payment_processing_cost_cents, 'duplicate', true);
  end if;
  select * into v_region from domain.service_regions sr where sr.normalized_key = p_region_key and sr.active;
  if not found then
    v_status := 'UNSUPPORTED';
    insert into domain.quotes(id, idempotency_key, customer_id, status, tank_tier, timing_kind, access_type, requested_service_date,
      service_window_start_at, address_snapshot, service_notes, expires_at)
    values (v_quote_id, p_idempotency_key, v_customer_id, v_status, p_tank_tier, p_timing_kind, p_access_type, p_requested_service_date,
      p_service_window_start_at, p_address_snapshot, p_service_notes, pg_catalog.now() + interval '30 minutes');
    return pg_catalog.jsonb_build_object('quoteId', v_quote_id, 'status', v_status);
  end if;
  select * into strict v_settings from domain.marketplace_settings ms where ms.active;
  if p_tank_tier = 'UNKNOWN' then
    v_status := 'REVIEW_REQUIRED';
    insert into domain.quotes(id, idempotency_key, customer_id, status, service_region_id, tank_tier, timing_kind, access_type,
      requested_service_date, service_window_start_at, address_snapshot, service_notes, marketplace_settings_version, expires_at)
    values (v_quote_id, p_idempotency_key, v_customer_id, v_status, v_region.id, p_tank_tier, p_timing_kind, p_access_type,
      p_requested_service_date, p_service_window_start_at, p_address_snapshot, p_service_notes, v_settings.version,
      pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.quote_ttl_minutes));
    return pg_catalog.jsonb_build_object('quoteId', v_quote_id, 'status', v_status);
  end if;
  select rpb.version, rpr.customer_subtotal_cents, rpr.customer_fee_cents
    into v_price
  from domain.regional_price_books rpb
  join domain.regional_price_rules rpr on rpr.price_book_id = rpb.id
  where rpb.active and rpr.service_region_id = v_region.id and rpr.tank_tier = p_tank_tier and rpr.timing_kind = p_timing_kind;
  if not found then
    v_status := 'REVIEW_REQUIRED';
    insert into domain.quotes(id, idempotency_key, customer_id, status, service_region_id, tank_tier, timing_kind, access_type,
      requested_service_date, service_window_start_at, address_snapshot, service_notes, marketplace_settings_version, expires_at)
    values (v_quote_id, p_idempotency_key, v_customer_id, v_status, v_region.id, p_tank_tier, p_timing_kind, p_access_type,
      p_requested_service_date, p_service_window_start_at, p_address_snapshot, p_service_notes, v_settings.version,
      pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.quote_ttl_minutes));
    return pg_catalog.jsonb_build_object('quoteId', v_quote_id, 'status', v_status);
  end if;
  v_total := v_price.customer_subtotal_cents + v_price.customer_fee_cents;
  v_estimated_fee := ((v_total * v_settings.estimated_processing_rate_bps + 9999) / 10000) + v_settings.estimated_processing_fixed_cents;
  insert into domain.quotes(id, idempotency_key, customer_id, status, service_region_id, tank_tier, timing_kind, access_type,
    requested_service_date, service_window_start_at, address_snapshot, service_notes, regional_price_book_version,
    marketplace_settings_version, customer_subtotal_cents, customer_fee_cents, customer_total_cents,
    estimated_payment_processing_cost_cents, expires_at)
  values (v_quote_id, p_idempotency_key, v_customer_id, 'UNAVAILABLE', v_region.id, p_tank_tier, p_timing_kind, p_access_type,
    p_requested_service_date, p_service_window_start_at, p_address_snapshot, p_service_notes, v_price.version,
    v_settings.version, v_price.customer_subtotal_cents, v_price.customer_fee_cents, v_total, v_estimated_fee,
    pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.quote_ttl_minutes));

  for v_candidate in
    select cc.id as contractor_company_id, cc.priority, cc.stripe_connected_account_id,
           cpb.version as contractor_price_book_version, cpr.contractor_gross_cents,
           coalesce(cfc.fee_bps, v_settings.default_contractor_fee_bps) as fee_bps,
           coalesce(cfc.fixed_fee_cents, v_settings.default_contractor_fixed_fee_cents) as fixed_fee_cents,
           ca.max_jobs,
           (select pg_catalog.count(*) from domain.order_assignments oa join domain.orders existing_order on existing_order.id = oa.order_id
             where oa.contractor_company_id = cc.id and oa.released_at is null and existing_order.requested_service_date = p_requested_service_date) as assigned_jobs
    from domain.contractor_companies cc
    join domain.contractor_service_regions csr on csr.contractor_company_id = cc.id and csr.service_region_id = v_region.id
    join domain.contractor_availability ca on ca.contractor_company_id = cc.id and ca.iso_weekday = extract(isodow from p_requested_service_date)::integer
    join domain.contractor_price_books cpb on cpb.contractor_company_id = cc.id and cpb.active
    join domain.contractor_price_rules cpr on cpr.price_book_id = cpb.id and cpr.tank_tier = p_tank_tier and cpr.timing_kind = p_timing_kind
      and (cpr.service_region_id is null or cpr.service_region_id = v_region.id)
    left join domain.contractor_fee_configs cfc on cfc.contractor_company_id = cc.id
    where cc.status = 'APPROVED' and cc.stripe_connected_account_id is not null
      and cc.stripe_details_submitted and cc.stripe_charges_enabled and cc.stripe_payouts_enabled
      and ca.max_jobs > 0 and (p_timing_kind <> 'URGENT' or ca.urgent_enabled)
      and not exists (select 1 from domain.contractor_blackout_dates cbd where cbd.contractor_company_id = cc.id and cbd.blackout_date = p_requested_service_date)
    order by cc.priority, cc.id
  loop
    if v_candidate.assigned_jobs >= v_candidate.max_jobs then
      continue;
    end if;
    v_candidate_count := v_candidate_count + 1;
    v_rank := v_rank + 1;
    v_marketplace_fee := least(v_candidate.contractor_gross_cents,
      ((v_candidate.contractor_gross_cents * v_candidate.fee_bps + 5000) / 10000) + v_candidate.fixed_fee_cents);
    v_payout := v_candidate.contractor_gross_cents - v_marketplace_fee;
    v_net := v_total - v_payout - v_estimated_fee;
    if v_payout <= v_total and v_net >= v_settings.minimum_contribution_margin_cents then
      v_viable_count := v_viable_count + 1;
    end if;
    insert into domain.quote_candidates(quote_id, contractor_company_id, rank, contractor_price_book_version,
      contractor_gross_cents, contractor_marketplace_fee_cents, contractor_payout_cents, stripe_transfer_amount_cents,
      platform_gross_retained_cents, platform_pricing_adjustment_cents, estimated_payment_processing_cost_cents,
      expected_platform_net_contribution_cents, meets_guardrail, eligibility_snapshot)
    values (v_quote_id, v_candidate.contractor_company_id, v_rank, v_candidate.contractor_price_book_version,
      v_candidate.contractor_gross_cents, v_marketplace_fee, v_payout, v_payout, v_total - v_payout,
      v_price.customer_subtotal_cents - v_candidate.contractor_gross_cents, v_estimated_fee, v_net,
      v_payout <= v_total and v_net >= v_settings.minimum_contribution_margin_cents,
      pg_catalog.jsonb_build_object('evaluatedAt', pg_catalog.now(), 'maxJobs', v_candidate.max_jobs, 'assignedJobs', v_candidate.assigned_jobs));
  end loop;
  if v_viable_count > 0 then
    v_status := 'PRICED';
  elsif v_candidate_count > 0 then
    v_status := 'REVIEW_REQUIRED';
  else
    v_status := 'UNAVAILABLE';
  end if;
  update domain.quotes set status = v_status where id = v_quote_id;
  return pg_catalog.jsonb_build_object(
    'quoteId', v_quote_id, 'status', v_status, 'expiresAt', (select expires_at from domain.quotes where id = v_quote_id),
    'customerSubtotalCents', v_price.customer_subtotal_cents, 'customerFeeCents', v_price.customer_fee_cents,
    'customerTotalCents', v_total, 'estimatedPaymentProcessingCostCents', v_estimated_fee,
    'eligibleCandidateCount', v_candidate_count, 'viableCandidateCount', v_viable_count
  );
end
$function$;

create or replace function api.create_booking(
  p_quote_id uuid,
  p_stripe_customer_id text,
  p_payment_method_id text,
  p_setup_intent_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_customer domain.customers%rowtype;
  v_quote domain.quotes%rowtype;
  v_property_id uuid;
  v_order_id uuid;
  v_settings domain.marketplace_settings%rowtype;
  v_candidate record;
  v_limit integer;
  v_created integer := 0;
  v_marketplace_fee integer;
  v_payout integer;
  v_estimated_fee integer;
  v_net integer;
  v_min_margin integer;
begin
  if identity.uid() is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into strict v_customer from domain.customers c where c.auth_user_id = identity.uid();
  select * into v_quote from domain.quotes q where q.id = p_quote_id for update;
  if not found or v_quote.status <> 'PRICED' or v_quote.expires_at <= pg_catalog.now() then
    raise exception using errcode = '22023', message = 'QUOTE_NOT_BOOKABLE';
  end if;
  if v_quote.customer_id is not null and v_quote.customer_id <> v_customer.id then
    raise exception using errcode = '42501', message = 'QUOTE_NOT_OWNED';
  end if;
  if not exists (
    select 1 from internal.verified_setup_intents vsi
    where vsi.setup_intent_id = p_setup_intent_id
      and vsi.auth_user_id = identity.uid()
      and vsi.stripe_customer_id = p_stripe_customer_id
      and vsi.payment_method_id = p_payment_method_id
      and vsi.provider_status = 'succeeded'
      and vsi.usage = 'off_session'
      and vsi.consent_recorded_at is not null
      and vsi.consumed_at is null
  ) then
    raise exception using errcode = '42501', message = 'VERIFIED_SETUP_INTENT_REQUIRED';
  end if;
  if pg_catalog.length(p_idempotency_key) < 8 then raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if exists (select 1 from domain.order_events oe where oe.idempotency_key = p_idempotency_key) then
    select oe.order_id into v_order_id from domain.order_events oe where oe.idempotency_key = p_idempotency_key limit 1;
    return pg_catalog.jsonb_build_object('orderId', v_order_id, 'duplicate', true);
  end if;
  select * into strict v_settings from domain.marketplace_settings ms where ms.active;
  select coalesce((select qeo.minimum_contribution_margin_cents from domain.quote_economics_overrides qeo where qeo.quote_id = v_quote.id),
    v_settings.minimum_contribution_margin_cents) into v_min_margin;
  insert into domain.properties(customer_id, address_line1, address_line2, city, state_code, postal_code, county_name,
    normalized_address, latitude, longitude, known_tank_tier, default_access_instructions)
  values (v_customer.id, v_quote.address_snapshot ->> 'addressLine1', v_quote.address_snapshot ->> 'addressLine2',
    v_quote.address_snapshot ->> 'city', v_quote.address_snapshot ->> 'stateCode', v_quote.address_snapshot ->> 'postalCode',
    v_quote.address_snapshot ->> 'countyName', v_quote.address_snapshot ->> 'normalizedAddress',
    (v_quote.address_snapshot ->> 'latitude')::numeric, (v_quote.address_snapshot ->> 'longitude')::numeric,
    v_quote.tank_tier, v_quote.address_snapshot ->> 'accessInstructions') returning id into v_property_id;
  insert into domain.orders(customer_id, property_id, quote_id, tank_tier, timing_kind, access_type,
    requested_service_date, service_window_start_at, address_snapshot, service_notes, customer_subtotal_cents,
    customer_fee_cents, customer_total_cents, marketplace_settings_version, regional_price_book_version,
    stripe_customer_id, stripe_payment_method_id, stripe_setup_intent_id)
  values (v_customer.id, v_property_id, v_quote.id, v_quote.tank_tier, v_quote.timing_kind, v_quote.access_type,
    v_quote.requested_service_date, v_quote.service_window_start_at, v_quote.address_snapshot, v_quote.service_notes,
    v_quote.customer_subtotal_cents, v_quote.customer_fee_cents, v_quote.customer_total_cents,
    v_quote.marketplace_settings_version, v_quote.regional_price_book_version, p_stripe_customer_id,
    p_payment_method_id, p_setup_intent_id) returning id into v_order_id;
  v_limit := case when v_quote.timing_kind = 'URGENT' then 3 else 1 end;
  v_estimated_fee := ((v_quote.customer_total_cents * v_settings.estimated_processing_rate_bps + 9999) / 10000)
    + v_settings.estimated_processing_fixed_cents;
  for v_candidate in
    select cc.id as contractor_company_id, cc.priority, cpb.version as contractor_price_book_version,
      cpr.contractor_gross_cents,
      coalesce(cfc.fee_bps, v_settings.default_contractor_fee_bps) as fee_bps,
      coalesce(cfc.fixed_fee_cents, v_settings.default_contractor_fixed_fee_cents) as fixed_fee_cents,
      ca.max_jobs,
      (select pg_catalog.count(*) from domain.order_assignments oa join domain.orders o2 on o2.id = oa.order_id
        where oa.contractor_company_id = cc.id and oa.released_at is null and o2.requested_service_date = v_quote.requested_service_date) as assigned_jobs
    from domain.contractor_companies cc
    join domain.contractor_service_regions csr on csr.contractor_company_id = cc.id and csr.service_region_id = v_quote.service_region_id
    join domain.contractor_availability ca on ca.contractor_company_id = cc.id
      and ca.iso_weekday = extract(isodow from v_quote.requested_service_date)::integer
    join domain.contractor_price_books cpb on cpb.contractor_company_id = cc.id and cpb.active
    join domain.contractor_price_rules cpr on cpr.price_book_id = cpb.id and cpr.tank_tier = v_quote.tank_tier
      and cpr.timing_kind = v_quote.timing_kind and (cpr.service_region_id is null or cpr.service_region_id = v_quote.service_region_id)
    left join domain.contractor_fee_configs cfc on cfc.contractor_company_id = cc.id
    where cc.status = 'APPROVED' and cc.stripe_connected_account_id is not null
      and cc.stripe_details_submitted and cc.stripe_charges_enabled and cc.stripe_payouts_enabled
      and ca.max_jobs > 0 and (v_quote.timing_kind <> 'URGENT' or ca.urgent_enabled)
      and not exists (select 1 from domain.contractor_blackout_dates cbd
        where cbd.contractor_company_id = cc.id and cbd.blackout_date = v_quote.requested_service_date)
    order by cc.priority,
      ((select pg_catalog.count(*) from domain.order_assignments oa join domain.orders o2 on o2.id = oa.order_id
        where oa.contractor_company_id = cc.id and oa.released_at is null and o2.requested_service_date = v_quote.requested_service_date)::numeric / ca.max_jobs),
      cc.id
  loop
    if v_created >= v_limit then exit; end if;
    if v_candidate.assigned_jobs >= v_candidate.max_jobs then continue; end if;
    v_marketplace_fee := least(v_candidate.contractor_gross_cents,
      ((v_candidate.contractor_gross_cents * v_candidate.fee_bps + 5000) / 10000) + v_candidate.fixed_fee_cents);
    v_payout := v_candidate.contractor_gross_cents - v_marketplace_fee;
    v_net := v_quote.customer_total_cents - v_payout - v_estimated_fee;
    if v_payout > v_quote.customer_total_cents or v_net < v_min_margin then continue; end if;
    insert into domain.order_offers(order_id, contractor_company_id, expires_at, contractor_price_book_version,
      marketplace_settings_version, estimated_processing_rate_bps, estimated_processing_fixed_cents, minimum_contribution_margin_cents_applied,
      contractor_gross_cents, contractor_marketplace_fee_cents, contractor_payout_cents, platform_pricing_adjustment_cents,
      estimated_payment_processing_cost_cents, expected_platform_net_contribution_cents)
    values (v_order_id, v_candidate.contractor_company_id,
      pg_catalog.now() + pg_catalog.make_interval(mins => case when v_quote.timing_kind = 'URGENT' then v_settings.urgent_offer_ttl_minutes else v_settings.scheduled_offer_ttl_minutes end),
      v_candidate.contractor_price_book_version, v_settings.version, v_settings.estimated_processing_rate_bps,
      v_settings.estimated_processing_fixed_cents, v_min_margin, v_candidate.contractor_gross_cents,
      v_marketplace_fee, v_payout,
      v_quote.customer_subtotal_cents - v_candidate.contractor_gross_cents, v_estimated_fee, v_net);
    v_created := v_created + 1;
  end loop;
  if v_created = 0 then raise exception using errcode = 'P0001', message = 'SUPPLY_CHANGED_REQUOTE_REQUIRED'; end if;
  update domain.quotes set status = 'CONVERTED', customer_id = v_customer.id, converted_at = pg_catalog.now() where id = v_quote.id;
  update internal.verified_setup_intents set consumed_at = pg_catalog.now()
    where setup_intent_id = p_setup_intent_id and auth_user_id = identity.uid() and consumed_at is null;
  insert into domain.order_events(order_id, event_type, resulting_status, actor_type, actor_user_id, idempotency_key)
  values (v_order_id, 'BOOKING_SUBMITTED', 'SEARCHING_CONTRACTOR', 'CUSTOMER', identity.uid(), p_idempotency_key);
  insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
  values ('booking.created', 'order', v_order_id, p_idempotency_key || ':notification', pg_catalog.jsonb_build_object('orderId', v_order_id));
  return pg_catalog.jsonb_build_object('orderId', v_order_id, 'status', 'SEARCHING_CONTRACTOR', 'offerCount', v_created);
end
$function$;

create or replace function api.accept_order_offer(p_offer_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_offer domain.order_offers%rowtype;
  v_order domain.orders%rowtype;
  v_company domain.contractor_companies%rowtype;
  v_assignment_id uuid;
  v_generation_id uuid;
  v_generation_number integer;
  v_max_jobs integer;
  v_assigned_jobs integer;
  v_settings domain.marketplace_settings%rowtype;
  v_auth_target timestamptz;
  v_payment_status domain.payment_generation_status;
  v_current_price record;
  v_marketplace_fee integer;
  v_payout integer;
  v_estimated_fee integer;
  v_net integer;
  v_min_margin integer;
begin
  if identity.uid() is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_offer from domain.order_offers oo where oo.id = p_offer_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'OFFER_NOT_FOUND'; end if;
  select * into v_order from domain.orders o where o.id = v_offer.order_id for update;
  if exists (select 1 from domain.order_assignments oa where oa.order_id = v_order.id and oa.released_at is null) then
    raise exception using errcode = 'P0001', message = 'ALREADY_ASSIGNED';
  end if;
  if not exists (select 1 from domain.contractor_users cu where cu.auth_user_id = identity.uid() and cu.contractor_company_id = v_offer.contractor_company_id and cu.active) then
    raise exception using errcode = '42501', message = 'OFFER_NOT_OWNED';
  end if;
  if v_offer.status <> 'OPEN' or v_offer.expires_at <= pg_catalog.now() or v_order.status <> 'SEARCHING_CONTRACTOR' then
    raise exception using errcode = 'P0001', message = 'OFFER_NOT_ACCEPTABLE';
  end if;
  select * into strict v_company from domain.contractor_companies cc where cc.id = v_offer.contractor_company_id;
  if v_company.status <> 'APPROVED' or not v_company.stripe_details_submitted or not v_company.stripe_charges_enabled or not v_company.stripe_payouts_enabled or v_company.stripe_connected_account_id is null then
    raise exception using errcode = 'P0001', message = 'CONTRACTOR_INELIGIBLE';
  end if;
  select ca.max_jobs into v_max_jobs from domain.contractor_availability ca
    where ca.contractor_company_id = v_company.id and ca.iso_weekday = extract(isodow from v_order.requested_service_date)::integer
      and (v_order.timing_kind <> 'URGENT' or ca.urgent_enabled);
  if v_max_jobs is null or exists (select 1 from domain.contractor_blackout_dates cbd where cbd.contractor_company_id = v_company.id and cbd.blackout_date = v_order.requested_service_date) then
    raise exception using errcode = 'P0001', message = 'CONTRACTOR_UNAVAILABLE';
  end if;
  insert into domain.contractor_day_capacity(contractor_company_id, service_date, max_jobs_snapshot)
    values (v_company.id, v_order.requested_service_date, v_max_jobs)
    on conflict (contractor_company_id, service_date) do nothing;
  perform 1 from domain.contractor_day_capacity cdc where cdc.contractor_company_id = v_company.id and cdc.service_date = v_order.requested_service_date for update;
  select pg_catalog.count(*) into v_assigned_jobs from domain.order_assignments oa join domain.orders o2 on o2.id = oa.order_id
    where oa.contractor_company_id = v_company.id and oa.released_at is null and o2.requested_service_date = v_order.requested_service_date;
  if v_assigned_jobs >= v_max_jobs then raise exception using errcode = 'P0001', message = 'CAPACITY_EXHAUSTED'; end if;
  select * into strict v_settings from domain.marketplace_settings ms where ms.active;
  select coalesce((select qeo.minimum_contribution_margin_cents from domain.quote_economics_overrides qeo where qeo.quote_id = v_order.quote_id),
    v_settings.minimum_contribution_margin_cents) into v_min_margin;
  select cpb.version as contractor_price_book_version, cpr.contractor_gross_cents,
    coalesce(cfc.fee_bps, v_settings.default_contractor_fee_bps) as fee_bps,
    coalesce(cfc.fixed_fee_cents, v_settings.default_contractor_fixed_fee_cents) as fixed_fee_cents
  into v_current_price
  from domain.quotes q
  join domain.contractor_service_regions csr on csr.contractor_company_id = v_company.id and csr.service_region_id = q.service_region_id
  join domain.contractor_price_books cpb on cpb.contractor_company_id = v_company.id and cpb.active
  join domain.contractor_price_rules cpr on cpr.price_book_id = cpb.id and cpr.tank_tier = v_order.tank_tier
    and cpr.timing_kind = v_order.timing_kind and (cpr.service_region_id is null or cpr.service_region_id = q.service_region_id)
  left join domain.contractor_fee_configs cfc on cfc.contractor_company_id = v_company.id
  where q.id = v_order.quote_id;
  if not found then raise exception using errcode = 'P0001', message = 'CURRENT_CONTRACTOR_PRICING_OR_COVERAGE_UNAVAILABLE'; end if;
  v_marketplace_fee := least(v_current_price.contractor_gross_cents,
    ((v_current_price.contractor_gross_cents * v_current_price.fee_bps + 5000) / 10000) + v_current_price.fixed_fee_cents);
  v_payout := v_current_price.contractor_gross_cents - v_marketplace_fee;
  v_estimated_fee := ((v_order.customer_total_cents * v_settings.estimated_processing_rate_bps + 9999) / 10000)
    + v_settings.estimated_processing_fixed_cents;
  v_net := v_order.customer_total_cents - v_payout - v_estimated_fee;
  if v_payout > v_order.customer_total_cents then raise exception using errcode = '23514', message = 'PAYOUT_NOT_FUNDED'; end if;
  if v_net < v_min_margin then raise exception using errcode = 'P0001', message = 'CONTRIBUTION_GUARDRAIL_FAILED'; end if;
  update domain.order_offers set status = 'ACCEPTED', responded_at = pg_catalog.now(),
    contractor_price_book_version = v_current_price.contractor_price_book_version,
    marketplace_settings_version = v_settings.version,
    estimated_processing_rate_bps = v_settings.estimated_processing_rate_bps,
    estimated_processing_fixed_cents = v_settings.estimated_processing_fixed_cents,
    minimum_contribution_margin_cents_applied = v_min_margin,
    contractor_gross_cents = v_current_price.contractor_gross_cents,
    contractor_marketplace_fee_cents = v_marketplace_fee,
    contractor_payout_cents = v_payout,
    platform_pricing_adjustment_cents = v_order.customer_subtotal_cents - v_current_price.contractor_gross_cents,
    estimated_payment_processing_cost_cents = v_estimated_fee,
    expected_platform_net_contribution_cents = v_net
  where id = v_offer.id;
  update domain.order_offers set status = 'WITHDRAWN', responded_at = pg_catalog.now() where order_id = v_order.id and id <> v_offer.id and status = 'OPEN';
  insert into domain.order_assignments(order_id, contractor_company_id, offer_id)
    values (v_order.id, v_company.id, v_offer.id) returning id into v_assignment_id;
  update domain.orders set status = 'SCHEDULED', version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
  select coalesce(pg_catalog.max(pg.generation_number), 0) + 1 into v_generation_number from domain.payment_generations pg where pg.order_id = v_order.id;
  v_auth_target := v_order.service_window_start_at - pg_catalog.make_interval(mins => v_settings.authorization_lead_time_minutes);
  if v_order.timing_kind = 'URGENT' or v_auth_target <= pg_catalog.now() then v_payment_status := 'REQUESTED'; else v_payment_status := 'AUTHORIZATION_SCHEDULED'; end if;
  insert into domain.payment_generations(order_id, assignment_id, generation_number, status, connected_account_id,
    contractor_price_book_version, marketplace_settings_version, estimated_processing_rate_bps,
    estimated_processing_fixed_cents, minimum_contribution_margin_cents_applied,
    customer_total_cents, contractor_gross_cents, contractor_marketplace_fee_cents, contractor_payout_cents,
    stripe_transfer_amount_cents, platform_gross_retained_cents, platform_pricing_adjustment_cents,
    estimated_payment_processing_cost_cents, expected_platform_net_contribution_cents, authorization_target_at)
  values (v_order.id, v_assignment_id, v_generation_number, v_payment_status, v_company.stripe_connected_account_id,
    v_current_price.contractor_price_book_version, v_settings.version, v_settings.estimated_processing_rate_bps,
    v_settings.estimated_processing_fixed_cents, v_min_margin,
    v_order.customer_total_cents, v_current_price.contractor_gross_cents, v_marketplace_fee,
    v_payout, v_payout, v_order.customer_total_cents - v_payout,
    v_order.customer_subtotal_cents - v_current_price.contractor_gross_cents, v_estimated_fee,
    v_net, v_auth_target) returning id into v_generation_id;
  insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
  values ('AUTHORIZE_PAYMENT', 'payment_generation', v_generation_id, greatest(v_auth_target, pg_catalog.now()),
    'authorize:' || v_generation_id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation_id));
  insert into domain.order_events(order_id, event_type, previous_status, resulting_status, actor_type, actor_user_id, idempotency_key, metadata)
  values (v_order.id, 'OFFER_ACCEPTED', 'SEARCHING_CONTRACTOR', 'SCHEDULED', 'CONTRACTOR', identity.uid(), p_idempotency_key,
    pg_catalog.jsonb_build_object('offerId', v_offer.id, 'assignmentId', v_assignment_id, 'paymentGenerationId', v_generation_id));
  insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
  values ('assignment.created', 'order', v_order.id, p_idempotency_key || ':notification', pg_catalog.jsonb_build_object('orderId', v_order.id, 'contractorCompanyId', v_company.id));
  return pg_catalog.jsonb_build_object('assignmentId', v_assignment_id, 'paymentGenerationId', v_generation_id, 'status', 'SCHEDULED');
end
$function$;

create or replace function api.transition_job(p_order_id uuid, p_action text, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order domain.orders%rowtype;
  v_assignment domain.order_assignments%rowtype;
  v_payment domain.payment_generations%rowtype;
  v_previous domain.order_status;
  v_next domain.order_status;
begin
  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND'; end if;
  select * into strict v_assignment from domain.order_assignments oa where oa.order_id = v_order.id and oa.released_at is null;
  if not exists (select 1 from domain.contractor_users cu where cu.auth_user_id = identity.uid() and cu.contractor_company_id = v_assignment.contractor_company_id and cu.active) then
    raise exception using errcode = '42501', message = 'ORDER_NOT_ASSIGNED_TO_ACTOR';
  end if;
  select * into strict v_payment from domain.payment_generations pg where pg.order_id = v_order.id and pg.is_current for update;
  v_previous := v_order.status;
  case p_action
    when 'MARK_EN_ROUTE' then
      if v_order.status <> 'SCHEDULED' then raise exception using errcode = 'P0001', message = 'ILLEGAL_TRANSITION'; end if;
      if v_payment.status <> 'AUTHORIZED' and not v_payment.authorization_override then raise exception using errcode = 'P0001', message = 'PAYMENT_AUTHORIZATION_REQUIRED'; end if;
      v_next := 'EN_ROUTE';
    when 'MARK_ARRIVED' then
      if v_order.status <> 'EN_ROUTE' then raise exception using errcode = 'P0001', message = 'ILLEGAL_TRANSITION'; end if;
      v_next := 'ARRIVED';
    when 'COMPLETE' then
      if v_order.status <> 'ARRIVED' then raise exception using errcode = 'P0001', message = 'ILLEGAL_TRANSITION'; end if;
      if v_order.access_type = 'UNATTENDED' and not exists (select 1 from domain.job_proofs jp where jp.order_id = v_order.id and jp.assignment_id = v_assignment.id and jp.status = 'VERIFIED') then
        raise exception using errcode = 'P0001', message = 'VERIFIED_PROOF_REQUIRED';
      end if;
      v_next := 'SERVICE_COMPLETED';
      update domain.payment_generations set status = 'CAPTURE_PENDING', updated_at = pg_catalog.now() where id = v_payment.id;
      insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
      values ('CAPTURE_PAYMENT', 'payment_generation', v_payment.id, pg_catalog.now(), 'capture:' || v_payment.id::text,
        pg_catalog.jsonb_build_object('paymentGenerationId', v_payment.id)) on conflict (idempotency_key) do nothing;
    when 'FAIL_ACCESS' then
      if v_order.status not in ('SCHEDULED', 'EN_ROUTE', 'ARRIVED') then raise exception using errcode = 'P0001', message = 'ILLEGAL_TRANSITION'; end if;
      if pg_catalog.length(coalesce(p_reason, '')) < 3 then raise exception using errcode = '22023', message = 'FAILURE_REASON_REQUIRED'; end if;
      v_next := 'FAILED_ACCESS';
    when 'FAIL_SERVICE' then
      if v_order.status not in ('SCHEDULED', 'EN_ROUTE', 'ARRIVED') then raise exception using errcode = 'P0001', message = 'ILLEGAL_TRANSITION'; end if;
      if pg_catalog.length(coalesce(p_reason, '')) < 3 then raise exception using errcode = '22023', message = 'FAILURE_REASON_REQUIRED'; end if;
      v_next := 'FAILED_SERVICE';
    else raise exception using errcode = '22023', message = 'UNKNOWN_ACTION';
  end case;
  update domain.orders set status = v_next, version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
  insert into domain.order_events(order_id, event_type, previous_status, resulting_status, actor_type, actor_user_id, idempotency_key, metadata)
  values (v_order.id, p_action, v_previous, v_next, 'CONTRACTOR', identity.uid(), p_idempotency_key,
    pg_catalog.jsonb_build_object('reason', p_reason, 'assignmentId', v_assignment.id));
  return pg_catalog.jsonb_build_object('orderId', v_order.id, 'status', v_next);
end
$function$;

create or replace function api.register_job_proof(p_order_id uuid, p_storage_path text, p_mime_type text, p_size_bytes integer, p_checksum_sha256 text, p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_assignment_id uuid;
  v_proof_id uuid;
begin
  if pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select oa.id into v_assignment_id from domain.order_assignments oa
  join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id
  where oa.order_id = p_order_id and oa.released_at is null and cu.auth_user_id = identity.uid() and cu.active;
  if v_assignment_id is null then raise exception using errcode = '42501', message = 'PROOF_UPLOAD_NOT_AUTHORIZED'; end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') or p_size_bytes not between 1 and 10485760 or p_checksum_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PROOF_METADATA';
  end if;
  if p_storage_path not like p_order_id::text || '/%' then raise exception using errcode = '22023', message = 'INVALID_STORAGE_PATH'; end if;
  select jp.id into v_proof_id from domain.job_proofs jp
  where jp.idempotency_key = p_idempotency_key and jp.order_id = p_order_id and jp.assignment_id = v_assignment_id and jp.uploaded_by = identity.uid();
  if found then return v_proof_id; end if;
  insert into domain.job_proofs(idempotency_key, order_id, assignment_id, storage_path, mime_type, size_bytes, checksum_sha256, uploaded_by)
  values (p_idempotency_key, p_order_id, v_assignment_id, p_storage_path, p_mime_type, p_size_bytes, p_checksum_sha256, identity.uid()) returning id into v_proof_id;
  return v_proof_id;
end
$function$;

create or replace function api.admin_override_authorization(p_order_id uuid, p_reason text, p_idempotency_key text) returns void
language plpgsql security definer set search_path = ''
as $function$
declare v_payment_id uuid;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if pg_catalog.length(coalesce(p_reason, '')) < 10 then raise exception using errcode = '22023', message = 'OVERRIDE_REASON_REQUIRED'; end if;
  select pg.id into v_payment_id from domain.payment_generations pg where pg.order_id = p_order_id and pg.is_current for update;
  if v_payment_id is null then raise exception using errcode = 'P0002', message = 'PAYMENT_GENERATION_NOT_FOUND'; end if;
  update domain.payment_generations set authorization_override = true, authorization_override_reason = p_reason, updated_at = pg_catalog.now() where id = v_payment_id;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'PAYMENT_AUTHORIZATION_OVERRIDE', 'order', p_order_id, p_reason,
    pg_catalog.jsonb_build_object('idempotencyKey', p_idempotency_key, 'paymentGenerationId', v_payment_id));
  insert into domain.order_events(order_id, event_type, actor_type, actor_user_id, idempotency_key, metadata)
  values (p_order_id, 'PAYMENT_AUTHORIZATION_OVERRIDE', 'ADMIN', identity.uid(), p_idempotency_key, pg_catalog.jsonb_build_object('reason', p_reason));
end
$function$;

create or replace function internal.claim_due_work(p_worker_id text, p_limit integer default 20) returns table(id uuid, task_type text, aggregate_id uuid, payload jsonb)
language plpgsql security definer set search_path = ''
as $function$
begin
  if pg_catalog.length(p_worker_id) < 3 or p_limit not between 1 and 100 then raise exception using errcode = '22023', message = 'INVALID_LEASE_REQUEST'; end if;
  return query
  with due as (
    select st.id from internal.scheduled_tasks st
    where st.due_at <= pg_catalog.now() and (st.status = 'PENDING' or (st.status = 'LEASED' and st.lease_expires_at < pg_catalog.now()))
    order by st.due_at for update skip locked limit p_limit
  ), leased as (
    update internal.scheduled_tasks st set status = 'LEASED', lease_owner = p_worker_id,
      lease_expires_at = pg_catalog.now() + interval '2 minutes', attempts = st.attempts + 1
    from due where st.id = due.id returning st.id, st.task_type, st.aggregate_id, st.payload
  ) select leased.id, leased.task_type, leased.aggregate_id, leased.payload from leased;
end
$function$;

create or replace function internal.complete_work(p_task_id uuid, p_worker_id text, p_succeeded boolean, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update internal.scheduled_tasks set
    status = case when p_succeeded then 'COMPLETED'::domain.work_status when attempts >= 5 then 'FAILED'::domain.work_status else 'PENDING'::domain.work_status end,
    due_at = case when p_succeeded or attempts >= 5 then due_at else pg_catalog.now() + pg_catalog.make_interval(secs => least(900, 15 * attempts * attempts)) end,
    completed_at = case when p_succeeded then pg_catalog.now() else null end, last_error = case when p_succeeded then null else pg_catalog.left(p_error, 1000) end,
    lease_owner = null, lease_expires_at = null
  where id = p_task_id and status = 'LEASED' and lease_owner = p_worker_id;
  if not found then raise exception using errcode = 'P0001', message = 'TASK_LEASE_NOT_OWNED'; end if;
end
$function$;

create or replace function internal.record_authorization_result(
  p_payment_generation_id uuid, p_provider_payment_intent_id text, p_status domain.payment_generation_status,
  p_capture_before timestamptz, p_failure_code text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order_status domain.order_status;
begin
  if p_status not in ('AUTHORIZATION_PENDING', 'AUTHORIZED', 'ACTION_REQUIRED', 'FAILED') then
    raise exception using errcode = '22023', message = 'INVALID_AUTHORIZATION_RESULT';
  end if;
  select o.status into v_order_status
  from domain.payment_generations pg
  join domain.orders o on o.id = pg.order_id
  where pg.id = p_payment_generation_id and pg.is_current
  for update of pg, o;
  if not found then raise exception using errcode = 'P0001', message = 'PAYMENT_GENERATION_NOT_AUTHORIZABLE'; end if;
  update domain.payment_generations set provider_payment_intent_id = coalesce(provider_payment_intent_id, p_provider_payment_intent_id),
    status = case when v_order_status = 'REASSIGNMENT_PENDING' then 'CANCELLATION_PENDING'::domain.payment_generation_status else p_status end,
    capture_before = p_capture_before, failure_code = p_failure_code, updated_at = pg_catalog.now()
  where id = p_payment_generation_id and is_current and status = 'AUTHORIZATION_PENDING';
  if not found then raise exception using errcode = 'P0001', message = 'PAYMENT_GENERATION_NOT_AUTHORIZABLE'; end if;
  if v_order_status = 'REASSIGNMENT_PENDING' then
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
    values ('CANCEL_AUTHORIZATION', 'payment_generation', p_payment_generation_id, pg_catalog.now(),
      'cancel:' || p_payment_generation_id::text,
      pg_catalog.jsonb_build_object('paymentGenerationId', p_payment_generation_id))
    on conflict (idempotency_key) do nothing;
  end if;
end
$function$;

create or replace function internal.process_payment_webhook(
  p_provider_event_id text, p_event_type text, p_livemode boolean, p_payload_sha256 text,
  p_provider_payment_intent_id text, p_processing_fee_cents integer default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_generation domain.payment_generations%rowtype;
  v_order domain.orders%rowtype;
begin
  insert into internal.webhook_events(provider, provider_event_id, event_type, livemode, payload_sha256)
  values ('STRIPE', p_provider_event_id, p_event_type, p_livemode, p_payload_sha256)
  on conflict (provider_event_id) do nothing;
  if not found then return pg_catalog.jsonb_build_object('duplicate', true); end if;
  if p_livemode then
    update internal.webhook_events set status = 'IGNORED', processed_at = pg_catalog.now(), error_message = 'Live events disabled in pilot implementation' where provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object('ignored', true);
  end if;
  select * into v_generation from domain.payment_generations pg where pg.provider_payment_intent_id = p_provider_payment_intent_id for update;
  if not found then
    update internal.webhook_events set status = 'IGNORED', processed_at = pg_catalog.now(), error_message = 'Unknown payment intent' where provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object('ignored', true);
  end if;
  select * into strict v_order from domain.orders o where o.id = v_generation.order_id for update;
  case p_event_type
    when 'payment_intent.amount_capturable_updated' then
      if v_generation.is_current and v_generation.status in ('AUTHORIZATION_PENDING', 'REQUESTED', 'AUTHORIZATION_SCHEDULED', 'ACTION_REQUIRED') then
        update domain.payment_generations set status = 'AUTHORIZED', updated_at = pg_catalog.now() where id = v_generation.id;
      end if;
    when 'payment_intent.payment_failed' then
      if v_generation.is_current and v_order.status not in ('REASSIGNMENT_PENDING','CANCELLED')
         and v_generation.status not in ('CAPTURED', 'SUPERSEDED', 'CANCELLED', 'CANCELLATION_PENDING') then
        update domain.payment_generations set status = 'ACTION_REQUIRED', failure_code = 'PAYMENT_FAILED', updated_at = pg_catalog.now() where id = v_generation.id;
        insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
          values ('payment.action_required', 'order', v_order.id, 'stripe:' || p_provider_event_id || ':notification',
            pg_catalog.jsonb_build_object('orderId', v_order.id, 'paymentGenerationId', v_generation.id))
          on conflict (idempotency_key) do nothing;
      end if;
    when 'payment_intent.canceled' then
      update domain.payment_generations set status = case when is_current then 'CANCELLED'::domain.payment_generation_status else 'SUPERSEDED'::domain.payment_generation_status end,
        updated_at = pg_catalog.now() where id = v_generation.id and status <> 'CAPTURED';
    when 'payment_intent.succeeded' then
      if v_generation.is_current and v_order.status = 'SERVICE_COMPLETED' and v_generation.status in ('CAPTURE_PENDING', 'AUTHORIZED') then
        update domain.payment_generations set status = 'CAPTURED', stripe_processing_fee_cents = p_processing_fee_cents,
          actual_platform_net_transaction_cents = customer_total_cents - contractor_payout_cents - coalesce(p_processing_fee_cents, 0),
          updated_at = pg_catalog.now() where id = v_generation.id;
        update domain.orders set status = 'CLOSED', version = version + 1, updated_at = pg_catalog.now() where id = v_order.id;
        insert into domain.financial_ledger_entries(order_id, payment_generation_id, entry_type, amount_cents, provider_reference, provider_event_id, occurred_at)
          values (v_order.id, v_generation.id, 'CAPTURE', v_generation.customer_total_cents, p_provider_payment_intent_id, p_provider_event_id, pg_catalog.now());
        insert into domain.financial_ledger_entries(order_id, payment_generation_id, entry_type, amount_cents, provider_reference, provider_event_id, occurred_at)
          values (v_order.id, v_generation.id, 'CONTRACTOR_TRANSFER', v_generation.stripe_transfer_amount_cents, p_provider_payment_intent_id || ':transfer', p_provider_event_id, pg_catalog.now());
        if p_processing_fee_cents is not null then
          insert into domain.financial_ledger_entries(order_id, payment_generation_id, entry_type, amount_cents, provider_reference, provider_event_id, occurred_at)
            values (v_order.id, v_generation.id, 'STRIPE_PROCESSING_FEE', p_processing_fee_cents, p_provider_payment_intent_id || ':balance_transaction_fee', null, pg_catalog.now());
        end if;
        insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
          values ('RECONCILE_PAYMENT', 'payment_generation', v_generation.id, pg_catalog.now() + interval '5 minutes',
            'reconcile:' || v_generation.id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id))
          on conflict (idempotency_key) do nothing;
        insert into domain.order_events(order_id, event_type, previous_status, resulting_status, actor_type, idempotency_key, metadata)
          values (v_order.id, 'PAYMENT_CAPTURED', 'SERVICE_COMPLETED', 'CLOSED', 'SYSTEM', 'stripe:' || p_provider_event_id,
            pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id));
      end if;
    else null;
  end case;
  update internal.webhook_events set status = 'PROCESSED', processed_at = pg_catalog.now() where provider_event_id = p_provider_event_id;
  return pg_catalog.jsonb_build_object('processed', true, 'paymentGenerationId', v_generation.id);
end
$function$;

-- Routine ownership, execute allowlists, and direct-mutation denial.
grant create on schema api, internal to drainly_routine_owner;
alter function api.create_quote(text, domain.tank_tier, domain.timing_kind, domain.access_type, date, timestamptz, jsonb, text, text) owner to drainly_routine_owner;
alter function api.create_booking(uuid, text, text, text, text) owner to drainly_routine_owner;
alter function api.accept_order_offer(uuid, text) owner to drainly_routine_owner;
alter function api.transition_job(uuid, text, text, text) owner to drainly_routine_owner;
alter function api.register_job_proof(uuid, text, text, integer, text, text) owner to drainly_routine_owner;
alter function api.admin_override_authorization(uuid, text, text) owner to drainly_routine_owner;
alter function internal.claim_due_work(text, integer) owner to drainly_routine_owner;
alter function internal.complete_work(uuid, text, boolean, text) owner to drainly_routine_owner;
alter function internal.record_authorization_result(uuid, text, domain.payment_generation_status, timestamptz, text) owner to drainly_routine_owner;
alter function internal.process_payment_webhook(text, text, boolean, text, text, integer) owner to drainly_routine_owner;
revoke create on schema api, internal from drainly_routine_owner;

revoke all on all functions in schema api, internal from public, anon, authenticated, drainly_system;
grant execute on function api.create_quote(text, domain.tank_tier, domain.timing_kind, domain.access_type, date, timestamptz, jsonb, text, text) to anon, authenticated;
grant execute on function api.create_booking(uuid, text, text, text, text) to authenticated;
grant execute on function api.accept_order_offer(uuid, text) to authenticated;
grant execute on function api.transition_job(uuid, text, text, text) to authenticated;
grant execute on function api.register_job_proof(uuid, text, text, integer, text, text) to authenticated;
grant execute on function api.admin_override_authorization(uuid, text, text) to authenticated;
grant execute on function internal.claim_due_work(text, integer) to drainly_system;
grant execute on function internal.complete_work(uuid, text, boolean, text) to drainly_system;
grant execute on function internal.record_authorization_result(uuid, text, domain.payment_generation_status, timestamptz, text) to drainly_system;
grant execute on function internal.process_payment_webhook(text, text, boolean, text, text, integer) to drainly_system;

-- Private storage bucket. Object policies use the first path segment as order id.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('job-proofs', 'job-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy job_proof_object_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'job-proofs'
  and exists (
    select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id
    where oa.order_id::text = (storage.foldername(name))[1] and oa.released_at is null and cu.auth_user_id = (select identity.uid()) and cu.active
  )
);
create policy job_proof_object_select on storage.objects for select to authenticated using (
  bucket_id = 'job-proofs'
  and (
    exists (select 1 from domain.orders o join domain.customers c on c.id = o.customer_id where o.id::text = (storage.foldername(name))[1] and c.auth_user_id = (select identity.uid()))
    or exists (select 1 from domain.order_assignments oa join domain.contractor_users cu on cu.contractor_company_id = oa.contractor_company_id where oa.order_id::text = (storage.foldername(name))[1] and oa.released_at is null and cu.auth_user_id = (select identity.uid()) and cu.active)
    or exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
  )
);

commit;
