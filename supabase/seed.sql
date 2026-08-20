-- All records in this seed file are fictional and intended only for local development/testing.

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'amy.customer@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Amy Customer"}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ben.customer@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Ben Customer"}', now(), now()),
  ('20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'johnston.owner@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Jordan Johnston"}', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'harnett.owner@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Harper Harnett"}', now(), now()),
  ('20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'dual.owner@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Casey Cross County"}', now(), now()),
  ('20000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pending.owner@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Pat Pending"}', now(), now()),
  ('20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'disabled.owner@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Drew Disabled"}', now(), now()),
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ops.admin@example.test', extensions.crypt('DrainlyDemo1!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Olivia Operations"}', now(), now())
on conflict (id) do nothing;

insert into domain.customers(id, auth_user_id, email, phone) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'amy.customer@example.test', '+19195550101'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'ben.customer@example.test', '+19195550102')
on conflict do nothing;

insert into domain.contractor_companies(id, legal_name, display_name, primary_contact_name, email, phone, operating_address, status, priority,
  stripe_connected_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled, internal_notes)
values
  ('40000000-0000-0000-0000-000000000001', 'Johnston Septic Services LLC', 'Johnston Septic', 'Jordan Johnston', 'johnston@example.test', '+19195550201', '100 Demo Road, Smithfield, NC', 'APPROVED', 10, 'acct_test_johnston', true, true, true, 'Fictional demo company.'),
  ('40000000-0000-0000-0000-000000000002', 'Harnett Pumping LLC', 'Harnett Pumping', 'Harper Harnett', 'harnett@example.test', '+19195550202', '200 Demo Road, Lillington, NC', 'APPROVED', 20, 'acct_test_harnett', true, true, true, 'Fictional demo company.'),
  ('40000000-0000-0000-0000-000000000003', 'Cross County Wastewater Inc', 'Cross County Septic', 'Casey Cross County', 'dual@example.test', '+19195550203', '300 Demo Road, Angier, NC', 'APPROVED', 30, 'acct_test_dual', true, true, true, 'Fictional demo company with 0% pilot fee.'),
  ('40000000-0000-0000-0000-000000000004', 'Pending Septic LLC', 'Pending Septic', 'Pat Pending', 'pending@example.test', '+19195550204', '400 Demo Road, Benson, NC', 'PENDING', 40, 'acct_test_pending', true, true, true, 'Fictional pending company.'),
  ('40000000-0000-0000-0000-000000000005', 'Disabled Septic LLC', 'Disabled Septic', 'Drew Disabled', 'disabled@example.test', '+19195550205', '500 Demo Road, Dunn, NC', 'DISABLED', 50, 'acct_test_disabled', true, true, true, 'Fictional disabled company.')
on conflict do nothing;

insert into domain.contractor_users(contractor_company_id, auth_user_id, role) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'OWNER'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'OWNER'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'OWNER'),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'OWNER'),
  ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'OWNER')
on conflict do nothing;

insert into domain.platform_admins(auth_user_id, role) values
  ('30000000-0000-0000-0000-000000000001', 'SUPER_ADMIN')
on conflict do nothing;

insert into domain.contractor_verifications(contractor_company_id, verification_type, status, reference, verified_at, notes) values
  ('40000000-0000-0000-0000-000000000001', 'PILOT_APPROVAL', 'VERIFIED', 'DEMO-J-001', now(), 'Fictional verification.'),
  ('40000000-0000-0000-0000-000000000002', 'PILOT_APPROVAL', 'VERIFIED', 'DEMO-H-001', now(), 'Fictional verification.'),
  ('40000000-0000-0000-0000-000000000003', 'PILOT_APPROVAL', 'VERIFIED', 'DEMO-X-001', now(), 'Fictional verification.')
on conflict do nothing;

insert into domain.service_regions(id, kind, state_code, county_name, normalized_key) values
  ('50000000-0000-0000-0000-000000000001', 'COUNTY', 'NC', 'Johnston County', 'US-NC-JOHNSTON'),
  ('50000000-0000-0000-0000-000000000002', 'COUNTY', 'NC', 'Harnett County', 'US-NC-HARNETT')
on conflict do nothing;

insert into domain.contractor_service_regions(contractor_company_id, service_region_id) values
  ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000002')
on conflict do nothing;

insert into domain.contractor_availability(contractor_company_id, iso_weekday, max_jobs, urgent_enabled)
select company_id, weekday, case when company_id = '40000000-0000-0000-0000-000000000003'::uuid then 4 else 3 end, weekday between 1 and 5
from unnest(array[
  '40000000-0000-0000-0000-000000000001'::uuid,
  '40000000-0000-0000-0000-000000000002'::uuid,
  '40000000-0000-0000-0000-000000000003'::uuid,
  '40000000-0000-0000-0000-000000000004'::uuid,
  '40000000-0000-0000-0000-000000000005'::uuid
]) company_id
cross join generate_series(1, 6) weekday
on conflict do nothing;

insert into domain.marketplace_settings(id, version, active, authorization_lead_time_minutes,
  estimated_processing_rate_bps, estimated_processing_fixed_cents, minimum_contribution_margin_cents,
  default_contractor_fee_bps, default_contractor_fixed_fee_cents)
values ('60000000-0000-0000-0000-000000000001', 1, true, 2880, 300, 30, 1000, 1000, 0)
on conflict do nothing;

insert into domain.regional_price_books(id, version, active) values
  ('70000000-0000-0000-0000-000000000001', 1, true)
on conflict do nothing;

insert into domain.regional_price_rules(price_book_id, service_region_id, tank_tier, timing_kind, customer_subtotal_cents, customer_fee_cents)
select '70000000-0000-0000-0000-000000000001', region_id, tank::domain.tank_tier, timing::domain.timing_kind,
  base_cents + case timing when 'URGENT' then 10000 when 'EARLIEST' then 1500 else 0 end, 0
from unnest(array['50000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000002'::uuid]) region_id
cross join (values ('GAL_750', 32500), ('GAL_1000', 36500), ('GAL_1250', 40500), ('GAL_1500', 44500)) tiers(tank, base_cents)
cross join unnest(array['SCHEDULED', 'EARLIEST', 'URGENT']) timing
on conflict do nothing;

insert into domain.contractor_price_books(id, contractor_company_id, version, active) values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, true),
  ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, true),
  ('80000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 1, true),
  ('80000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 1, true),
  ('80000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 1, true)
on conflict do nothing;

insert into domain.contractor_price_rules(price_book_id, tank_tier, timing_kind, contractor_gross_cents)
select book_id, tank::domain.tank_tier, timing::domain.timing_kind,
  base_cents + company_adjustment + case timing when 'URGENT' then 7000 when 'EARLIEST' then 1000 else 0 end
from (values
  ('80000000-0000-0000-0000-000000000001'::uuid, 0),
  ('80000000-0000-0000-0000-000000000002'::uuid, 1000),
  ('80000000-0000-0000-0000-000000000003'::uuid, -1000),
  ('80000000-0000-0000-0000-000000000004'::uuid, 500),
  ('80000000-0000-0000-0000-000000000005'::uuid, 500)
) books(book_id, company_adjustment)
cross join (values ('GAL_750', 29000), ('GAL_1000', 32500), ('GAL_1250', 36000), ('GAL_1500', 39500)) tiers(tank, base_cents)
cross join unnest(array['SCHEDULED', 'EARLIEST', 'URGENT']) timing
on conflict do nothing;

-- Cross County participates with a 0% pilot fee; all others use the marketplace default.
insert into domain.contractor_fee_configs(contractor_company_id, fee_bps, fixed_fee_cents)
values ('40000000-0000-0000-0000-000000000003', 0, 0)
on conflict do nothing;

insert into domain.properties(id, customer_id, address_line1, city, state_code, postal_code, county_name,
  normalized_address, latitude, longitude, known_tank_tier, default_access_instructions)
values
  ('12000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '101 Fictional Farm Road', 'Smithfield', 'NC', '27577', 'Johnston County', '101 Fictional Farm Road, Smithfield, NC 27577', 35.5085, -78.3394, 'GAL_1000', 'Gate code is fictional: 1234'),
  ('12000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', '202 Fictional Creek Lane', 'Lillington', 'NC', '27546', 'Harnett County', '202 Fictional Creek Lane, Lillington, NC 27546', 35.3993, -78.8159, 'GAL_1250', 'Customer will be present')
on conflict do nothing;

-- Deterministic open-offer order for concurrency and authorization tests.
insert into domain.quotes(id, customer_id, status, service_region_id, tank_tier, timing_kind, access_type,
  requested_service_date, service_window_start_at, address_snapshot, regional_price_book_version,
  marketplace_settings_version, customer_subtotal_cents, customer_fee_cents, customer_total_cents,
  estimated_payment_processing_cost_cents, expires_at, converted_at)
values ('90000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'CONVERTED',
  '50000000-0000-0000-0000-000000000001', 'GAL_1000', 'URGENT', 'UNATTENDED', current_date + 1,
  (current_date + 1 + time '08:00') at time zone 'America/New_York',
  '{"addressLine1":"101 Fictional Farm Road","addressLine2":null,"city":"Smithfield","stateCode":"NC","postalCode":"27577","countyName":"Johnston County","normalizedAddress":"101 Fictional Farm Road, Smithfield, NC 27577","latitude":35.5085,"longitude":-78.3394,"accessInstructions":"Gate code 1234"}',
  1, 1, 46500, 0, 46500, 1425, now() + interval '1 day', now())
on conflict do nothing;

insert into domain.orders(id, public_ref, customer_id, property_id, quote_id, tank_tier, timing_kind, access_type,
  requested_service_date, service_window_start_at, address_snapshot, service_notes, customer_subtotal_cents,
  customer_fee_cents, customer_total_cents, marketplace_settings_version, regional_price_book_version,
  stripe_customer_id, stripe_payment_method_id, stripe_setup_intent_id)
values ('91000000-0000-0000-0000-000000000001', 'DRN-DEMO-RACE', '11000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'GAL_1000', 'URGENT', 'UNATTENDED',
  current_date + 1, (current_date + 1 + time '08:00') at time zone 'America/New_York',
  '{"addressLine1":"101 Fictional Farm Road","city":"Smithfield","stateCode":"NC","postalCode":"27577","countyName":"Johnston County","normalizedAddress":"101 Fictional Farm Road, Smithfield, NC 27577","latitude":35.5085,"longitude":-78.3394,"accessInstructions":"Gate code 1234"}',
  'Fictional unattended urgent job.', 46500, 0, 46500, 1, 1, 'cus_test_demo', 'pm_test_demo', 'seti_test_demo')
on conflict do nothing;

insert into domain.order_offers(id, order_id, contractor_company_id, expires_at, contractor_price_book_version,
  marketplace_settings_version, estimated_processing_rate_bps, estimated_processing_fixed_cents, minimum_contribution_margin_cents_applied,
  contractor_gross_cents, contractor_marketplace_fee_cents, contractor_payout_cents, platform_pricing_adjustment_cents,
  estimated_payment_processing_cost_cents, expected_platform_net_contribution_cents)
values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', now() + interval '1 day', 1, 1, 300, 30, 1000, 39500, 3950, 35550, 7000, 1425, 9525),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', now() + interval '1 day', 1, 1, 300, 30, 1000, 38500, 0, 38500, 8000, 1425, 6575)
on conflict do nothing;
