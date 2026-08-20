begin;

alter table domain.notifications
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists provider_delivery_status text,
  add column if not exists provider_event_at timestamptz,
  add column if not exists provider_event_id text;

alter table domain.notifications
  drop constraint if exists notifications_provider_check,
  add constraint notifications_provider_check check (provider is null or provider in ('RESEND','FAKE'));

alter table domain.notifications
  drop constraint if exists notifications_provider_delivery_status_check,
  add constraint notifications_provider_delivery_status_check check (
    provider_delivery_status is null or provider_delivery_status in (
      'SENT','DELIVERED','DELAYED','BOUNCED','COMPLAINED','FAILED','SUPPRESSED'
    )
  );

create unique index if not exists notifications_provider_message_unique
  on domain.notifications (provider, provider_message_id)
  where provider_message_id is not null;

create table if not exists internal.notification_provider_events (
  provider_event_id text primary key,
  provider text not null check (provider in ('RESEND')),
  provider_message_id text not null,
  event_type text not null check (event_type in (
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed'
  )),
  occurred_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default pg_catalog.now()
);

create index if not exists notification_provider_events_message_idx
  on internal.notification_provider_events (provider, provider_message_id, occurred_at desc);

create or replace function internal.notification_provider_status(p_event_type text) returns text
language sql immutable security definer set search_path = ''
as $function$
  select case p_event_type
    when 'email.sent' then 'SENT'
    when 'email.delivered' then 'DELIVERED'
    when 'email.delivery_delayed' then 'DELAYED'
    when 'email.bounced' then 'BOUNCED'
    when 'email.complained' then 'COMPLAINED'
    when 'email.failed' then 'FAILED'
    when 'email.suppressed' then 'SUPPRESSED'
    else null
  end
$function$;

create or replace function internal.record_notification_provider_message(
  p_notification_id uuid,
  p_provider text,
  p_provider_message_id text
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_event internal.notification_provider_events%rowtype;
begin
  if p_provider not in ('RESEND','FAKE') or pg_catalog.length(pg_catalog.btrim(coalesce(p_provider_message_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_PROVIDER_MESSAGE';
  end if;

  update domain.notifications set
    provider = p_provider,
    provider_message_id = p_provider_message_id
  where id = p_notification_id and channel = 'EMAIL' and status = 'SENDING';

  if not found then
    raise exception using errcode = 'P0001', message = 'NOTIFICATION_NOT_SENDING';
  end if;

  if p_provider = 'RESEND' then
    select * into v_event
    from internal.notification_provider_events e
    where e.provider = p_provider and e.provider_message_id = p_provider_message_id
    order by e.occurred_at desc, e.received_at desc
    limit 1;

    if found then
      update domain.notifications set
        provider_delivery_status = internal.notification_provider_status(v_event.event_type),
        provider_event_at = v_event.occurred_at,
        provider_event_id = v_event.provider_event_id
      where id = p_notification_id;
    end if;
  end if;
end
$function$;

create or replace function internal.process_resend_webhook(
  p_provider_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_payload_sha256 text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_status text;
  v_matched integer;
begin
  v_status := internal.notification_provider_status(p_event_type);
  if v_status is null
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_provider_event_id, ''))) < 3
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_provider_message_id, ''))) < 3
     or p_occurred_at is null
     or coalesce(p_payload_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_RESEND_WEBHOOK_EVENT';
  end if;

  insert into internal.notification_provider_events(
    provider_event_id, provider, provider_message_id, event_type, occurred_at, payload_sha256
  ) values (
    p_provider_event_id, 'RESEND', p_provider_message_id, p_event_type, p_occurred_at, p_payload_sha256
  ) on conflict (provider_event_id) do nothing;

  if not found then
    return pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  update domain.notifications set
    provider_delivery_status = v_status,
    provider_event_at = p_occurred_at,
    provider_event_id = p_provider_event_id
  where provider = 'RESEND'
    and provider_message_id = p_provider_message_id
    and (provider_event_at is null or p_occurred_at >= provider_event_at);
  get diagnostics v_matched = row_count;

  return pg_catalog.jsonb_build_object('processed', true, 'matched', v_matched > 0, 'status', v_status);
end
$function$;

create or replace function internal.enqueue_order_lifecycle_notification() returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare v_topic text;
begin
  if old.status is not distinct from new.status then return new; end if;
  v_topic := case new.status
    when 'EN_ROUTE' then 'order.en_route'
    when 'ARRIVED' then 'order.arrived'
    when 'SERVICE_COMPLETED' then 'order.service_completed'
    when 'CLOSED' then 'order.closed'
    when 'CANCELLED' then 'order.cancelled'
    when 'FAILED_ACCESS' then 'order.failed_access'
    when 'FAILED_SERVICE' then 'order.failed_service'
    else null
  end;
  if v_topic is null then return new; end if;

  insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
  values (
    v_topic,
    'order',
    new.id,
    'order-status:' || new.id::text || ':' || new.version::text || ':' || new.status::text,
    pg_catalog.jsonb_build_object('orderId', new.id, 'status', new.status)
  ) on conflict (idempotency_key) do nothing;
  return new;
end
$function$;

drop trigger if exists orders_enqueue_lifecycle_notification on domain.orders;
create trigger orders_enqueue_lifecycle_notification
after update of status on domain.orders
for each row execute function internal.enqueue_order_lifecycle_notification();

create or replace function internal.schedule_service_reminder() returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.status = 'SCHEDULED' and old.status is distinct from new.status then
    insert into internal.scheduled_tasks(task_type, aggregate_type, aggregate_id, due_at, idempotency_key, payload)
    values (
      'SEND_SERVICE_REMINDER',
      'order',
      new.id,
      greatest(new.service_window_start_at - interval '24 hours', pg_catalog.now()),
      'service-reminder-task:' || new.id::text || ':' || new.version::text,
      pg_catalog.jsonb_build_object('orderId', new.id)
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end
$function$;

drop trigger if exists orders_schedule_service_reminder on domain.orders;
create trigger orders_schedule_service_reminder
after update of status on domain.orders
for each row execute function internal.schedule_service_reminder();

create or replace function internal.enqueue_service_reminder(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare v_order domain.orders%rowtype;
begin
  select * into v_order from domain.orders o where o.id = p_order_id;
  if not found or v_order.status <> 'SCHEDULED' then
    return pg_catalog.jsonb_build_object('enqueued', false);
  end if;

  insert into internal.outbox_messages(topic, aggregate_type, aggregate_id, idempotency_key, payload)
  values (
    'order.service_reminder',
    'order',
    v_order.id,
    'service-reminder:' || v_order.id::text,
    pg_catalog.jsonb_build_object('orderId', v_order.id)
  ) on conflict (idempotency_key) do nothing;

  return pg_catalog.jsonb_build_object('enqueued', true);
end
$function$;

grant create on schema internal to drainly_routine_owner;
alter function internal.notification_provider_status(text) owner to drainly_routine_owner;
alter function internal.record_notification_provider_message(uuid, text, text) owner to drainly_routine_owner;
alter function internal.process_resend_webhook(text, text, text, timestamptz, text) owner to drainly_routine_owner;
alter function internal.enqueue_order_lifecycle_notification() owner to drainly_routine_owner;
alter function internal.schedule_service_reminder() owner to drainly_routine_owner;
alter function internal.enqueue_service_reminder(uuid) owner to drainly_routine_owner;
revoke create on schema internal from drainly_routine_owner;

revoke all on function internal.notification_provider_status(text) from public, anon, authenticated;
revoke all on function internal.record_notification_provider_message(uuid, text, text) from public, anon, authenticated;
revoke all on function internal.process_resend_webhook(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function internal.enqueue_order_lifecycle_notification() from public, anon, authenticated, drainly_system;
revoke all on function internal.schedule_service_reminder() from public, anon, authenticated, drainly_system;
revoke all on function internal.enqueue_service_reminder(uuid) from public, anon, authenticated;

grant execute on function internal.record_notification_provider_message(uuid, text, text) to drainly_system;
grant execute on function internal.process_resend_webhook(text, text, text, timestamptz, text) to drainly_system;
grant execute on function internal.enqueue_service_reminder(uuid) to drainly_system;

grant select, insert on internal.notification_provider_events to drainly_routine_owner;

commit;
