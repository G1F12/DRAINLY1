-- Final audit hardening: bounded notification retries and narrowly scoped
-- recovery for terminal notification/payment worker failures.

alter table internal.outbox_messages
  add column retry_attempts integer not null default 0 check (retry_attempts >= 0),
  add column failed_at timestamptz,
  add column requeue_count integer not null default 0 check (requeue_count >= 0);

update internal.outbox_messages set retry_attempts = attempts;

create table domain.payment_operation_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references domain.orders(id) on delete restrict,
  assignment_id uuid not null references domain.order_assignments(id) on delete restrict,
  payment_generation_id uuid not null references domain.payment_generations(id) on delete restrict,
  failed_task_id uuid not null unique references internal.scheduled_tasks(id) on delete restrict,
  task_type text not null check (task_type in ('AUTHORIZE_PAYMENT','CAPTURE_PAYMENT','CANCEL_AUTHORIZATION','CANCEL_ORDER_AUTHORIZATION')),
  prior_order_status domain.order_status not null,
  status text not null default 'OPEN' check (status in ('OPEN','REQUEUED','RESOLVED')),
  safe_error text not null,
  requeued_task_id uuid references internal.scheduled_tasks(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  requeued_at timestamptz,
  resolved_at timestamptz
);

create index payment_operation_exceptions_open_idx
  on domain.payment_operation_exceptions (order_id, created_at desc) where status = 'OPEN';

alter table domain.payment_operation_exceptions enable row level security;
alter table domain.payment_operation_exceptions force row level security;
create policy payment_operation_exceptions_admin_select on domain.payment_operation_exceptions
  for select to authenticated using (
    exists (select 1 from domain.platform_admins pa where pa.auth_user_id = (select identity.uid()) and pa.active)
  );
create policy routine_owner_explicit_access on domain.payment_operation_exceptions
  for all to drainly_routine_owner using (true) with check (true);

grant select on domain.payment_operation_exceptions to authenticated, drainly_routine_owner;
grant insert, update on domain.payment_operation_exceptions to drainly_routine_owner;

create or replace view api.admin_order_overview with (security_invoker = true) as
select o.id, o.public_ref, o.status, o.requested_service_date, o.customer_total_cents,
       oa.contractor_company_id, cc.display_name as contractor_name, pg.status as payment_status,
       pg.platform_gross_retained_cents, pg.stripe_processing_fee_cents,
       pg.actual_platform_net_transaction_cents, o.updated_at,
       (poe.id is not null) as requires_admin_attention,
       poe.task_type as failed_payment_operation
from domain.orders o
left join domain.order_assignments oa on oa.order_id = o.id and oa.released_at is null
left join domain.contractor_companies cc on cc.id = oa.contractor_company_id
left join domain.payment_generations pg on pg.order_id = o.id and pg.is_current
left join lateral (
  select e.id, e.task_type
  from domain.payment_operation_exceptions e
  where e.order_id = o.id and e.status = 'OPEN'
  order by e.created_at desc limit 1
) poe on true;

create or replace function internal.max_worker_attempts() returns integer
language sql immutable security definer set search_path = ''
as $function$
  select 5
$function$;

create or replace function internal.safe_failure_code(p_error text) returns text
language sql immutable security definer set search_path = ''
as $function$
  select case
    when coalesce(p_error, '') ~* '(timeout|timed out|aborted)' then 'OUTBOUND_PROVIDER_TIMEOUT'
    else 'PROVIDER_OPERATION_FAILED'
  end
$function$;

create or replace function internal.claim_outbox(p_worker_id text, p_limit integer default 20)
returns table(id uuid, topic text, aggregate_id uuid, payload jsonb)
language plpgsql security definer set search_path = ''
as $function$
begin
  if pg_catalog.length(p_worker_id) < 3 or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_LEASE_REQUEST';
  end if;
  return query
  with due as (
    select om.id from internal.outbox_messages om
    where om.available_at <= pg_catalog.now()
      and (om.status = 'PENDING' or (om.status = 'LEASED' and om.lease_expires_at < pg_catalog.now()))
    order by om.available_at for update skip locked limit p_limit
  ), leased as (
    update internal.outbox_messages om set status = 'LEASED', lease_owner = p_worker_id,
      lease_expires_at = pg_catalog.now() + interval '2 minutes',
      attempts = om.attempts + 1, retry_attempts = om.retry_attempts + 1
    from due where om.id = due.id returning om.id, om.topic, om.aggregate_id, om.payload
  ) select leased.id, leased.topic, leased.aggregate_id, leased.payload from leased;
end
$function$;

create or replace function internal.complete_notification_delivery(
  p_notification_id uuid, p_succeeded boolean, p_error text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  update domain.notifications set
    status = case when p_succeeded then 'SENT'::domain.notification_status else 'FAILED'::domain.notification_status end,
    sent_at = case when p_succeeded then pg_catalog.now() else null end,
    last_error = case when p_succeeded then last_error else internal.safe_failure_code(p_error) end
  where id = p_notification_id and status = 'SENDING';
  if not found then raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_SENDING'; end if;
end
$function$;

create or replace function internal.complete_outbox(
  p_outbox_id uuid, p_worker_id text, p_succeeded boolean, p_error text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_terminal boolean;
begin
  select (not p_succeeded and om.retry_attempts >= internal.max_worker_attempts()) into v_terminal
  from internal.outbox_messages om
  where om.id = p_outbox_id and om.status = 'LEASED' and om.lease_owner = p_worker_id
  for update;
  if not found then raise exception using errcode = 'P0001', message = 'OUTBOX_LEASE_NOT_OWNED'; end if;

  update internal.outbox_messages set
    status = case when p_succeeded then 'COMPLETED'::domain.work_status
      when v_terminal then 'FAILED'::domain.work_status else 'PENDING'::domain.work_status end,
    completed_at = case when p_succeeded then pg_catalog.now() else null end,
    last_error = case when p_succeeded then last_error else internal.safe_failure_code(p_error) end,
    failed_at = case when v_terminal then pg_catalog.now() else failed_at end,
    available_at = case when p_succeeded or v_terminal then available_at
      else pg_catalog.now() + pg_catalog.make_interval(secs => least(900, 15 * retry_attempts * retry_attempts)) end,
    lease_owner = null, lease_expires_at = null
  where id = p_outbox_id;
end
$function$;

create or replace function api.requeue_failed_outbox(
  p_outbox_id uuid, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_message internal.outbox_messages%rowtype;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'OUTBOX_REQUEUE_REASON_REQUIRED';
  end if;
  if pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  select * into v_message from internal.outbox_messages om where om.id = p_outbox_id for update;
  if not found or v_message.status <> 'FAILED' then
    raise exception using errcode = 'P0001', message = 'FAILED_OUTBOX_REQUIRED';
  end if;
  update internal.outbox_messages set status = 'PENDING', available_at = pg_catalog.now(),
    lease_owner = null, lease_expires_at = null, retry_attempts = 0, requeue_count = requeue_count + 1
  where id = p_outbox_id;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'FAILED_OUTBOX_REQUEUED', 'outbox_message', p_outbox_id, p_reason,
    pg_catalog.jsonb_build_object('idempotencyKey', p_idempotency_key, 'priorAttempts', v_message.attempts,
      'priorFailedAt', v_message.failed_at, 'safeLastError', v_message.last_error));
  return pg_catalog.jsonb_build_object('outboxId', p_outbox_id, 'status', 'PENDING',
    'attemptsPreserved', v_message.attempts, 'providerIdempotencyKey', v_message.idempotency_key);
end
$function$;

create or replace function internal.complete_work(
  p_task_id uuid, p_worker_id text, p_succeeded boolean, p_error text default null
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_task internal.scheduled_tasks%rowtype;
  v_generation domain.payment_generations%rowtype;
  v_order domain.orders%rowtype;
  v_terminal boolean;
  v_safe_error text;
begin
  select * into v_task from internal.scheduled_tasks st
  where st.id = p_task_id and st.status = 'LEASED' and st.lease_owner = p_worker_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'TASK_LEASE_NOT_OWNED'; end if;
  v_terminal := not p_succeeded and v_task.attempts >= internal.max_worker_attempts();
  v_safe_error := internal.safe_failure_code(p_error);

  update internal.scheduled_tasks set
    status = case when p_succeeded then 'COMPLETED'::domain.work_status
      when v_terminal then 'FAILED'::domain.work_status else 'PENDING'::domain.work_status end,
    due_at = case when p_succeeded or v_terminal then due_at
      else pg_catalog.now() + pg_catalog.make_interval(secs => least(900, 15 * attempts * attempts)) end,
    completed_at = case when p_succeeded then pg_catalog.now() else null end,
    last_error = case when p_succeeded then last_error else v_safe_error end,
    lease_owner = null, lease_expires_at = null
  where id = p_task_id;

  if p_succeeded and v_task.task_type in ('AUTHORIZE_PAYMENT','CAPTURE_PAYMENT','CANCEL_AUTHORIZATION','CANCEL_ORDER_AUTHORIZATION') then
    update domain.payment_operation_exceptions set status = 'RESOLVED', resolved_at = pg_catalog.now()
    where payment_generation_id = v_task.aggregate_id and task_type = v_task.task_type and status in ('OPEN','REQUEUED');
  elsif v_terminal and v_task.task_type in ('AUTHORIZE_PAYMENT','CAPTURE_PAYMENT','CANCEL_AUTHORIZATION','CANCEL_ORDER_AUTHORIZATION') then
    select * into v_generation from domain.payment_generations pg where pg.id = v_task.aggregate_id and pg.is_current;
    if found then
      select * into strict v_order from domain.orders o where o.id = v_generation.order_id for update;
      insert into domain.payment_operation_exceptions(order_id, assignment_id, payment_generation_id, failed_task_id,
        task_type, prior_order_status, safe_error)
      values (v_order.id, v_generation.assignment_id, v_generation.id, v_task.id,
        v_task.task_type, v_order.status, v_safe_error)
      on conflict (failed_task_id) do nothing;
      insert into domain.order_events(order_id, event_type, actor_type, idempotency_key, metadata)
      values (v_order.id, 'PAYMENT_OPERATION_REQUIRES_ADMIN_REVIEW', 'SYSTEM',
        'terminal-payment-task:' || v_task.id::text,
        pg_catalog.jsonb_build_object('taskId', v_task.id, 'taskType', v_task.task_type,
          'paymentGenerationId', v_generation.id, 'assignmentId', v_generation.assignment_id,
          'serviceStatusPreserved', v_order.status, 'safeError', v_safe_error))
      on conflict (order_id, idempotency_key) do nothing;
      insert into domain.audit_records(actor_type, action, resource_type, resource_id, reason, metadata)
      values ('SYSTEM', 'PAYMENT_OPERATION_TERMINAL_FAILURE', 'scheduled_task', v_task.id,
        'Automatic payment retries exhausted',
        pg_catalog.jsonb_build_object('taskType', v_task.task_type, 'orderId', v_order.id,
          'paymentGenerationId', v_generation.id, 'attempts', v_task.attempts, 'safeError', v_safe_error));
      insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
      values ('payment.operation_failed', 'order', v_order.id, 'terminal-payment-task:' || v_task.id::text || ':alert',
        pg_catalog.jsonb_build_object('orderId', v_order.id, 'taskId', v_task.id, 'taskType', v_task.task_type))
      on conflict (idempotency_key) do nothing;
    end if;
  end if;
end
$function$;

create or replace function api.retry_failed_payment_operation(
  p_order_id uuid, p_task_type text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order domain.orders%rowtype;
  v_generation domain.payment_generations%rowtype;
  v_assignment domain.order_assignments%rowtype;
  v_exception domain.payment_operation_exceptions%rowtype;
  v_existing internal.scheduled_tasks%rowtype;
  v_retry_task_id uuid;
begin
  if not exists (select 1 from domain.platform_admins pa where pa.auth_user_id = identity.uid() and pa.active)
     or coalesce(identity.jwt() ->> 'aal', '') <> 'aal2'
     or not (coalesce(identity.jwt() -> 'amr', '[]'::pg_catalog.jsonb) @> '[{"method":"totp"}]'::pg_catalog.jsonb) then
    raise exception using errcode = '42501', message = 'ADMIN_MFA_REQUIRED';
  end if;
  if p_task_type not in ('AUTHORIZE_PAYMENT','CAPTURE_PAYMENT','CANCEL_AUTHORIZATION','CANCEL_ORDER_AUTHORIZATION') then
    raise exception using errcode = '22023', message = 'PAYMENT_RETRY_OPERATION_NOT_ALLOWED';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'PAYMENT_RETRY_REASON_REQUIRED';
  end if;
  if pg_catalog.length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select * into v_order from domain.orders o where o.id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND'; end if;
  select * into v_generation from domain.payment_generations pg
    where pg.order_id = p_order_id and pg.is_current for update;
  if not found then raise exception using errcode = 'P0002', message = 'CURRENT_PAYMENT_GENERATION_REQUIRED'; end if;
  select * into strict v_assignment from domain.order_assignments oa where oa.id = v_generation.assignment_id for update;

  select * into v_existing from internal.scheduled_tasks st
    where st.idempotency_key = 'admin-payment-retry:' || p_idempotency_key;
  if found then
    if v_existing.aggregate_id <> v_generation.id or v_existing.task_type <> p_task_type then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('taskId', v_existing.id, 'status', v_existing.status,
      'paymentGenerationId', v_generation.id, 'duplicate', true);
  end if;

  select * into v_exception from domain.payment_operation_exceptions e
  where e.order_id = p_order_id and e.payment_generation_id = v_generation.id
    and e.task_type = p_task_type and e.status = 'OPEN'
  order by e.created_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'OPEN_PAYMENT_OPERATION_EXCEPTION_REQUIRED'; end if;
  if exists (select 1 from internal.scheduled_tasks st where st.aggregate_id = v_generation.id
      and st.task_type = p_task_type and st.status in ('PENDING','LEASED')) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_RETRY_ALREADY_ACTIVE';
  end if;

  if p_task_type = 'AUTHORIZE_PAYMENT' then
    if v_order.status <> 'SCHEDULED' or v_assignment.released_at is not null
       or v_generation.status not in ('REQUESTED','AUTHORIZATION_SCHEDULED','AUTHORIZATION_PENDING','ACTION_REQUIRED')
       or v_generation.provider_payment_intent_id is not null then
      raise exception using errcode = 'P0001', message = 'AUTHORIZATION_RETRY_NOT_LOGICALLY_VALID';
    end if;
  elsif p_task_type = 'CAPTURE_PAYMENT' then
    if v_order.status <> 'SERVICE_COMPLETED' or v_assignment.released_at is not null
       or v_generation.status not in ('AUTHORIZED','CAPTURE_PENDING')
       or v_generation.provider_payment_intent_id is null
       or exists (select 1 from domain.financial_ledger_entries fle
         where fle.payment_generation_id = v_generation.id and fle.entry_type = 'CAPTURE') then
      raise exception using errcode = 'P0001', message = 'CAPTURE_RETRY_NOT_LOGICALLY_VALID';
    end if;
  else
    if v_generation.status <> 'CANCELLATION_PENDING' or v_generation.provider_payment_intent_id is null then
      raise exception using errcode = 'P0001', message = 'CANCELLATION_RETRY_NOT_LOGICALLY_VALID';
    end if;
  end if;

  insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
  values (p_task_type, 'payment_generation', v_generation.id, pg_catalog.now(),
    'admin-payment-retry:' || p_idempotency_key,
    pg_catalog.jsonb_build_object('paymentGenerationId', v_generation.id, 'recoveryOfTaskId', v_exception.failed_task_id))
  returning id into v_retry_task_id;
  update domain.payment_operation_exceptions set status = 'REQUEUED', requeued_at = pg_catalog.now(),
    requeued_task_id = v_retry_task_id where id = v_exception.id;
  insert into domain.audit_records(actor_user_id, actor_type, action, resource_type, resource_id, reason, metadata)
  values (identity.uid(), 'ADMIN', 'FAILED_PAYMENT_OPERATION_RETRIED', 'order', p_order_id, p_reason,
    pg_catalog.jsonb_build_object('idempotencyKey', p_idempotency_key, 'taskType', p_task_type,
      'failedTaskId', v_exception.failed_task_id, 'retryTaskId', v_retry_task_id,
      'assignmentId', v_assignment.id, 'paymentGenerationId', v_generation.id,
      'providerOperationIdempotencyKey', pg_catalog.lower(pg_catalog.split_part(p_task_type, '_', 1)) || ':' || v_generation.id::text));
  insert into domain.order_events(order_id, event_type, actor_type, actor_user_id, idempotency_key, metadata)
  values (p_order_id, 'FAILED_PAYMENT_OPERATION_RETRIED', 'ADMIN', identity.uid(), p_idempotency_key,
    pg_catalog.jsonb_build_object('taskType', p_task_type, 'failedTaskId', v_exception.failed_task_id,
      'retryTaskId', v_retry_task_id, 'assignmentId', v_assignment.id, 'paymentGenerationId', v_generation.id));
  return pg_catalog.jsonb_build_object('taskId', v_retry_task_id, 'status', 'PENDING',
    'paymentGenerationId', v_generation.id, 'duplicate', false);
end
$function$;

create function internal.resolve_payment_operation_exceptions() returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.status = 'AUTHORIZED' then
    update domain.payment_operation_exceptions set status = 'RESOLVED', resolved_at = pg_catalog.now()
    where payment_generation_id = new.id and task_type = 'AUTHORIZE_PAYMENT' and status in ('OPEN','REQUEUED');
  elsif new.status = 'CAPTURED' then
    update domain.payment_operation_exceptions set status = 'RESOLVED', resolved_at = pg_catalog.now()
    where payment_generation_id = new.id and task_type = 'CAPTURE_PAYMENT' and status in ('OPEN','REQUEUED');
  elsif new.status in ('CANCELLED','SUPERSEDED') then
    update domain.payment_operation_exceptions set status = 'RESOLVED', resolved_at = pg_catalog.now()
    where payment_generation_id = new.id and task_type in ('CANCEL_AUTHORIZATION','CANCEL_ORDER_AUTHORIZATION')
      and status in ('OPEN','REQUEUED');
  end if;
  return new;
end
$function$;

create trigger payment_generation_resolve_operation_exception
after update of status on domain.payment_generations
for each row when (old.status is distinct from new.status)
execute function internal.resolve_payment_operation_exceptions();

grant create on schema api, internal to drainly_routine_owner;
alter function internal.max_worker_attempts() owner to drainly_routine_owner;
alter function internal.safe_failure_code(text) owner to drainly_routine_owner;
alter function internal.claim_outbox(text, integer) owner to drainly_routine_owner;
alter function internal.complete_notification_delivery(uuid, boolean, text) owner to drainly_routine_owner;
alter function internal.complete_outbox(uuid, text, boolean, text) owner to drainly_routine_owner;
alter function api.requeue_failed_outbox(uuid, text, text) owner to drainly_routine_owner;
alter function internal.complete_work(uuid, text, boolean, text) owner to drainly_routine_owner;
alter function api.retry_failed_payment_operation(uuid, text, text, text) owner to drainly_routine_owner;
alter function internal.resolve_payment_operation_exceptions() owner to drainly_routine_owner;
revoke create on schema api, internal from drainly_routine_owner;

revoke all on function internal.max_worker_attempts() from public, anon, authenticated, drainly_system;
revoke all on function internal.safe_failure_code(text) from public, anon, authenticated, drainly_system;
revoke all on function internal.claim_outbox(text, integer) from public, anon, authenticated;
revoke all on function internal.complete_notification_delivery(uuid, boolean, text) from public, anon, authenticated;
revoke all on function internal.complete_outbox(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function api.requeue_failed_outbox(uuid, text, text) from public, anon, authenticated, drainly_system;
revoke all on function internal.complete_work(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function api.retry_failed_payment_operation(uuid, text, text, text) from public, anon, authenticated, drainly_system;
revoke all on function internal.resolve_payment_operation_exceptions() from public, anon, authenticated, drainly_system;

grant execute on function internal.max_worker_attempts() to drainly_routine_owner;
grant execute on function internal.safe_failure_code(text) to drainly_routine_owner;
grant execute on function internal.claim_outbox(text, integer) to drainly_system;
grant execute on function internal.complete_notification_delivery(uuid, boolean, text) to drainly_system;
grant execute on function internal.complete_outbox(uuid, text, boolean, text) to drainly_system;
grant execute on function internal.complete_work(uuid, text, boolean, text) to drainly_system;
grant execute on function api.requeue_failed_outbox(uuid, text, text) to authenticated;
grant execute on function api.retry_failed_payment_operation(uuid, text, text, text) to authenticated;
