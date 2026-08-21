begin;

create table if not exists domain.pilot_controls (
  id smallint primary key check (id = 1),
  booking_execution_enabled boolean not null default false,
  payment_execution_enabled boolean not null default false,
  allowed_payment_mode text not null default 'FAKE' check (allowed_payment_mode in ('FAKE','STRIPE_TEST')),
  max_customer_total_cents integer not null default 100000 check (max_customer_total_cents between 100 and 1000000),
  updated_at timestamptz not null default pg_catalog.now()
);

insert into domain.pilot_controls(id, booking_execution_enabled, payment_execution_enabled, allowed_payment_mode, max_customer_total_cents)
values (1, false, false, 'FAKE', 100000)
on conflict (id) do nothing;

grant select on domain.pilot_controls to drainly_routine_owner;
grant select on domain.contractor_companies to drainly_routine_owner;
grant select on domain.contractor_users to drainly_routine_owner;
grant select on domain.contractor_verifications to drainly_routine_owner;
grant select on domain.contractor_service_regions to drainly_routine_owner;
grant select on domain.contractor_availability to drainly_routine_owner;
grant select on domain.contractor_price_books to drainly_routine_owner;

grant usage, create on schema api to drainly_routine_owner;

create or replace function api.pilot_readiness() returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare
  v_control domain.pilot_controls%rowtype;
  v_total integer := 0;
  v_approved integer := 0;
  v_verification_ready integer := 0;
  v_dispatch_ready integer := 0;
  v_payment_ready integer := 0;
begin
  select * into strict v_control from domain.pilot_controls pc where pc.id = 1;

  select pg_catalog.count(*)::integer into v_total from domain.contractor_companies;
  select pg_catalog.count(*)::integer into v_approved from domain.contractor_companies cc where cc.status = 'APPROVED';

  select pg_catalog.count(*)::integer into v_verification_ready
  from domain.contractor_companies cc
  where exists (
    select 1 from domain.contractor_verifications cv
    where cv.contractor_company_id = cc.id and cv.verification_type = 'LICENSE_OR_PERMIT' and cv.status = 'VERIFIED'
  ) and exists (
    select 1 from domain.contractor_verifications cv
    where cv.contractor_company_id = cc.id and cv.verification_type = 'INSURANCE' and cv.status = 'VERIFIED'
  );

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
    and cc.stripe_connected_account_id is not null
    and cc.stripe_details_submitted
    and cc.stripe_charges_enabled
    and cc.stripe_payouts_enabled
    and exists (select 1 from domain.contractor_users cu where cu.contractor_company_id = cc.id and cu.active)
    and exists (select 1 from domain.contractor_service_regions csr where csr.contractor_company_id = cc.id)
    and exists (select 1 from domain.contractor_availability ca where ca.contractor_company_id = cc.id and ca.max_jobs > 0)
    and exists (select 1 from domain.contractor_price_books cpb where cpb.contractor_company_id = cc.id and cpb.active);

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
    'readyForDispatchDryRun', (v_dispatch_ready > 0),
    'readyForTestPayments', (v_control.booking_execution_enabled and v_control.payment_execution_enabled and v_control.allowed_payment_mode = 'STRIPE_TEST' and v_payment_ready > 0)
  );
end
$function$;

alter function api.pilot_readiness() owner to drainly_routine_owner;
revoke create on schema api from drainly_routine_owner;
revoke all on function api.pilot_readiness() from public, anon;
grant execute on function api.pilot_readiness() to authenticated;

commit;
