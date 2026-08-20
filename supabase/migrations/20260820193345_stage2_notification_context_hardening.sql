begin;

create or replace function internal.get_outbox_delivery_context(p_outbox_id uuid, p_worker_id text) returns jsonb
language plpgsql security definer stable set search_path = ''
as $function$
declare v_context jsonb;
begin
  select pg_catalog.jsonb_build_object(
    'outboxId', om.id,
    'topic', om.topic,
    'orderId', o.id,
    'publicRef', o.public_ref,
    'customerEmail', c.email,
    'customerPhone', c.phone,
    'contractorEmail', cc.email,
    'contractorPhone', cc.phone
  ) into v_context
  from internal.outbox_messages om
  join domain.orders o on o.id = om.aggregate_id and om.aggregate_type = 'order'
  join domain.customers c on c.id = o.customer_id
  left join lateral (
    select oa.contractor_company_id
    from domain.order_assignments oa
    where oa.order_id = o.id
    order by (oa.released_at is null) desc, oa.assigned_at desc
    limit 1
  ) latest_assignment on true
  left join domain.contractor_companies cc on cc.id = latest_assignment.contractor_company_id
  where om.id = p_outbox_id and om.status = 'LEASED' and om.lease_owner = p_worker_id;

  if v_context is null then
    raise exception using errcode = 'P0002', message = 'LEASED_OUTBOX_CONTEXT_NOT_FOUND';
  end if;
  return v_context;
end
$function$;

grant create on schema internal to drainly_routine_owner;
alter function internal.get_outbox_delivery_context(uuid, text) owner to drainly_routine_owner;
revoke create on schema internal from drainly_routine_owner;

revoke all on function internal.get_outbox_delivery_context(uuid, text) from public, anon, authenticated;
grant execute on function internal.get_outbox_delivery_context(uuid, text) to drainly_system;

commit;
