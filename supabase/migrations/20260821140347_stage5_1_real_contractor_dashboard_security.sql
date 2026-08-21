begin;

drop policy if exists offers_actor_select on domain.order_offers;
create policy offers_actor_select on domain.order_offers
for select to authenticated
using (
  exists (
    select 1
    from domain.contractor_users member
    where member.contractor_company_id = order_offers.contractor_company_id
      and member.auth_user_id = (select identity.uid())
      and member.active
  )
  or exists (
    select 1 from domain.platform_admins pa
    where pa.auth_user_id = (select identity.uid()) and pa.active
  )
);

drop policy if exists assignments_actor_select on domain.order_assignments;
create policy assignments_actor_select on domain.order_assignments
for select to authenticated
using (
  exists (
    select 1
    from domain.contractor_users member
    where member.contractor_company_id = order_assignments.contractor_company_id
      and member.auth_user_id = (select identity.uid())
      and member.active
  )
  or exists (
    select 1
    from domain.orders owned_order
    join domain.customers customer on customer.id = owned_order.customer_id
    where owned_order.id = order_assignments.order_id
      and customer.auth_user_id = (select identity.uid())
  )
  or exists (
    select 1 from domain.platform_admins pa
    where pa.auth_user_id = (select identity.uid()) and pa.active
  )
);

drop policy if exists orders_actor_select on domain.orders;
create policy orders_actor_select on domain.orders
for select to authenticated
using (
  exists (
    select 1 from domain.customers customer
    where customer.id = orders.customer_id
      and customer.auth_user_id = (select identity.uid())
  )
  or exists (
    select 1
    from domain.order_assignments assignment
    join domain.contractor_users member
      on member.contractor_company_id = assignment.contractor_company_id
    where assignment.order_id = orders.id
      and assignment.released_at is null
      and member.auth_user_id = (select identity.uid())
      and member.active
  )
  or exists (
    select 1 from domain.platform_admins pa
    where pa.auth_user_id = (select identity.uid()) and pa.active
  )
);

create or replace view api.contractor_offers
with (security_invoker = true)
as
select
  oo.id,
  oo.order_id,
  oo.status,
  oo.expires_at,
  oo.contractor_payout_cents,
  o.requested_service_date,
  o.timing_kind,
  o.tank_tier,
  o.address_snapshot ->> 'countyName' as county_name,
  o.address_snapshot ->> 'postalCode' as postal_code
from domain.order_offers oo
join domain.orders o on o.id = oo.order_id
join domain.contractor_users member
  on member.contractor_company_id = oo.contractor_company_id
 and member.auth_user_id = identity.uid()
 and member.active;

create or replace view api.contractor_jobs
with (security_invoker = true)
as
select
  oa.id as assignment_id,
  o.id as order_id,
  o.public_ref,
  o.status,
  o.requested_service_date,
  o.service_window_start_at,
  o.access_type,
  o.tank_tier,
  o.address_snapshot,
  pg.status as payment_status,
  pg.contractor_payout_cents
from domain.order_assignments oa
join domain.orders o on o.id = oa.order_id
join domain.contractor_users member
  on member.contractor_company_id = oa.contractor_company_id
 and member.auth_user_id = identity.uid()
 and member.active
left join domain.payment_generations pg
  on pg.assignment_id = oa.id and pg.is_current
where oa.released_at is null;

commit;
