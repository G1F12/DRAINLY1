begin;

-- Geography is authoritative only after the server-side geocoder resolves it.
-- Keep the routine out of the PostgREST caller allowlist and let the trusted
-- server database role invoke it after normalization.
revoke all on function api.create_quote(text, domain.tank_tier, domain.timing_kind, domain.access_type, date, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant usage on schema api to drainly_system;
grant execute on function api.create_quote(text, domain.tank_tier, domain.timing_kind, domain.access_type, date, timestamptz, jsonb, text, text)
  to drainly_system;

-- Every booking gets a durable no-assignment deadline at the same point at
-- which its payment authorization would need to begin.
create or replace function internal.schedule_assignment_deadline() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare v_lead_minutes integer;
begin
  select ms.authorization_lead_time_minutes into strict v_lead_minutes
  from domain.marketplace_settings ms where ms.active;
  insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
  values ('CHECK_ASSIGNMENT_DEADLINE', 'order', new.id,
    greatest(new.service_window_start_at - pg_catalog.make_interval(mins => v_lead_minutes), pg_catalog.now()),
    'assignment-deadline:' || new.id::text,
    pg_catalog.jsonb_build_object('orderId', new.id))
  on conflict (idempotency_key) do nothing;
  return new;
end
$function$;

create trigger orders_schedule_assignment_deadline
after insert on domain.orders
for each row execute function internal.schedule_assignment_deadline();

create or replace function internal.process_assignment_deadline(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order domain.orders%rowtype;
begin
  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found or v_order.status <> 'SEARCHING_CONTRACTOR' then
    return pg_catalog.jsonb_build_object('advanced', false);
  end if;
  update domain.order_offers set status = 'EXPIRED', responded_at = pg_catalog.now()
    where order_id = v_order.id and status = 'OPEN';
  update domain.orders set status = 'NEEDS_ADMIN_REVIEW', version = version + 1, updated_at = pg_catalog.now()
    where id = v_order.id;
  insert into domain.order_events(order_id, event_type, previous_status, resulting_status, actor_type, idempotency_key)
  values (v_order.id, 'ASSIGNMENT_DEADLINE_MISSED', 'SEARCHING_CONTRACTOR', 'NEEDS_ADMIN_REVIEW', 'SYSTEM',
    'assignment-deadline:' || v_order.id::text);
  insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
  values ('assignment.deadline_missed', 'order', v_order.id,
    'assignment-deadline:' || v_order.id::text || ':notification',
    pg_catalog.jsonb_build_object('orderId', v_order.id))
  on conflict (idempotency_key) do nothing;
  return pg_catalog.jsonb_build_object('advanced', true, 'status', 'NEEDS_ADMIN_REVIEW');
end
$function$;

-- If cancellation or reassignment wins while the provider authorization call
-- is in flight, persist that deterministic result and immediately queue the
-- correct cancellation before releasing the generation.
create or replace function internal.record_authorization_result(
  p_payment_generation_id uuid, p_provider_payment_intent_id text, p_status domain.payment_generation_status,
  p_capture_before timestamptz, p_failure_code text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order_status domain.order_status;
  v_task_type text;
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
  update domain.payment_generations set
    provider_payment_intent_id = coalesce(provider_payment_intent_id, p_provider_payment_intent_id),
    status = case
      when v_order_status in ('REASSIGNMENT_PENDING', 'CANCELLED', 'FAILED_ACCESS', 'FAILED_SERVICE') then 'CANCELLATION_PENDING'::domain.payment_generation_status
      else p_status
    end,
    capture_before = p_capture_before, failure_code = p_failure_code, updated_at = pg_catalog.now()
  where id = p_payment_generation_id and is_current and status = 'AUTHORIZATION_PENDING';
  if not found then raise exception using errcode = 'P0001', message = 'PAYMENT_GENERATION_NOT_AUTHORIZABLE'; end if;
  if v_order_status in ('REASSIGNMENT_PENDING', 'CANCELLED', 'FAILED_ACCESS', 'FAILED_SERVICE') then
    v_task_type := case when v_order_status = 'REASSIGNMENT_PENDING' then 'CANCEL_AUTHORIZATION' else 'CANCEL_ORDER_AUTHORIZATION' end;
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
    values (v_task_type, 'payment_generation', p_payment_generation_id, pg_catalog.now(),
      case when v_order_status = 'REASSIGNMENT_PENDING' then 'cancel:' else 'cancel-order:' end || p_payment_generation_id::text,
      pg_catalog.jsonb_build_object('paymentGenerationId', p_payment_generation_id))
    on conflict (idempotency_key) do nothing;
  end if;
end
$function$;

create or replace function internal.release_failed_order_payment() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare v_generation domain.payment_generations%rowtype;
begin
  if new.status not in ('FAILED_ACCESS','FAILED_SERVICE') or old.status = new.status then return new; end if;
  update domain.order_assignments set released_at = pg_catalog.now(), release_reason = new.status::text
    where order_id = new.id and released_at is null;
  select * into v_generation from domain.payment_generations pg where pg.order_id = new.id and pg.is_current for update;
  if not found then return new; end if;
  if v_generation.provider_payment_intent_id is not null and v_generation.status not in ('CANCELLED','SUPERSEDED') then
    update domain.payment_generations set status = 'CANCELLATION_PENDING', updated_at = pg_catalog.now()
      where id = v_generation.id;
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
    values ('CANCEL_ORDER_AUTHORIZATION', 'payment_generation', v_generation.id, pg_catalog.now(),
      'cancel-order:' || v_generation.id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id))
    on conflict (idempotency_key) do nothing;
  elsif v_generation.status <> 'AUTHORIZATION_PENDING' then
    update domain.payment_generations set status = 'CANCELLED', is_current = false, updated_at = pg_catalog.now()
      where id = v_generation.id;
  end if;
  return new;
end
$function$;

create trigger orders_release_failed_payment
after update of status on domain.orders
for each row execute function internal.release_failed_order_payment();

create or replace function internal.record_order_cancellation_release(p_payment_generation_id uuid) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update domain.payment_generations pg set status = 'CANCELLED', is_current = false, updated_at = pg_catalog.now()
  from domain.orders o
  where pg.id = p_payment_generation_id and pg.order_id = o.id
    and o.status in ('CANCELLED','FAILED_ACCESS','FAILED_SERVICE')
    and pg.status in ('CANCELLATION_PENDING','CANCELLED');
  if not found then raise exception using errcode = 'P0001', message = 'ORDER_CANCELLATION_RELEASE_NOT_APPLICABLE'; end if;
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
  v_authorization_pending boolean := false;
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
    if v_order.status in ('SERVICE_COMPLETED','CLOSED','CANCELLED') then
      raise exception using errcode = 'P0001', message = 'ORDER_NOT_CANCELLABLE_AFTER_SERVICE';
    end if;
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
      'cancel-order:' || v_generation.id::text, pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id))
    on conflict (idempotency_key) do nothing;
  elsif found and v_generation.status = 'AUTHORIZATION_PENDING' then
    v_authorization_pending := true;
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
    'cancellationPending', v_generation.provider_payment_intent_id is not null,
    'authorizationPending', v_authorization_pending);
end
$function$;

-- A refund can remain pending after the synchronous provider response. Stripe's
-- later refund webhook is therefore authoritative for the terminal ledger state.
create or replace function internal.process_refund_webhook(
  p_provider_event_id text, p_event_type text, p_livemode boolean, p_payload_sha256 text,
  p_provider_refund_id text, p_provider_status text, p_transfer_reversal_cents integer default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_refund domain.refunds%rowtype;
begin
  insert into internal.webhook_events(provider, provider_event_id, event_type, livemode, payload_sha256)
  values ('STRIPE', p_provider_event_id, p_event_type, p_livemode, p_payload_sha256)
  on conflict (provider_event_id) do nothing;
  if not found then return pg_catalog.jsonb_build_object('duplicate', true); end if;
  if p_livemode then
    update internal.webhook_events set status = 'IGNORED', processed_at = pg_catalog.now(),
      error_message = 'Live events disabled in pilot implementation' where provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object('ignored', true);
  end if;
  select * into v_refund from domain.refunds r where r.provider_refund_id = p_provider_refund_id for update;
  if not found then
    update internal.webhook_events set status = 'IGNORED', processed_at = pg_catalog.now(),
      error_message = 'Unknown refund' where provider_event_id = p_provider_event_id;
    return pg_catalog.jsonb_build_object('ignored', true);
  end if;
  if v_refund.status in ('REQUESTED','PENDING') then
    if p_provider_status = 'succeeded' then
      perform internal.record_refund_result(v_refund.id, p_provider_refund_id, 'SUCCEEDED', p_transfer_reversal_cents, null);
    elsif p_provider_status in ('failed','canceled') then
      perform internal.record_refund_result(v_refund.id, p_provider_refund_id, 'FAILED', p_transfer_reversal_cents, 'Provider refund failed');
    else
      perform internal.record_refund_result(v_refund.id, p_provider_refund_id, 'PENDING', p_transfer_reversal_cents, null);
    end if;
  end if;
  update internal.webhook_events set status = 'PROCESSED', processed_at = pg_catalog.now()
    where provider_event_id = p_provider_event_id;
  return pg_catalog.jsonb_build_object('processed', true, 'refundId', v_refund.id);
end
$function$;

grant create on schema api, internal to drainly_routine_owner;
alter function internal.schedule_assignment_deadline() owner to drainly_routine_owner;
alter function internal.process_assignment_deadline(uuid) owner to drainly_routine_owner;
alter function internal.record_authorization_result(uuid, text, domain.payment_generation_status, timestamptz, text) owner to drainly_routine_owner;
alter function api.cancel_order(uuid, text, text) owner to drainly_routine_owner;
alter function internal.process_refund_webhook(text, text, boolean, text, text, text, integer) owner to drainly_routine_owner;
alter function internal.release_failed_order_payment() owner to drainly_routine_owner;
alter function internal.record_order_cancellation_release(uuid) owner to drainly_routine_owner;
revoke create on schema api, internal from drainly_routine_owner;

revoke all on function internal.schedule_assignment_deadline() from public, anon, authenticated, drainly_system;
revoke all on function internal.process_assignment_deadline(uuid) from public, anon, authenticated;
revoke all on function internal.record_authorization_result(uuid, text, domain.payment_generation_status, timestamptz, text) from public, anon, authenticated;
revoke all on function api.cancel_order(uuid, text, text) from public, anon;
revoke all on function internal.process_refund_webhook(text, text, boolean, text, text, text, integer) from public, anon, authenticated;
revoke all on function internal.release_failed_order_payment() from public, anon, authenticated, drainly_system;
grant execute on function internal.process_assignment_deadline(uuid) to drainly_system;
grant execute on function internal.record_authorization_result(uuid, text, domain.payment_generation_status, timestamptz, text) to drainly_system;
grant execute on function api.cancel_order(uuid, text, text) to authenticated;
grant execute on function internal.process_refund_webhook(text, text, boolean, text, text, text, integer) to drainly_system;

commit;
