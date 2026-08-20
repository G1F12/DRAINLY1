begin;

create or replace function internal.claim_due_notification_work(
  p_worker_id text,
  p_limit integer default 20
) returns table(id uuid, task_type text, aggregate_id uuid, payload jsonb)
language plpgsql security definer set search_path = ''
as $function$
begin
  if pg_catalog.length(p_worker_id) < 3 or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_WORK_LEASE_REQUEST';
  end if;

  return query
  with due as (
    select st.id
    from internal.scheduled_tasks st
    where st.task_type = 'SEND_SERVICE_REMINDER'
      and st.due_at <= pg_catalog.now()
      and (st.status = 'PENDING' or (st.status = 'LEASED' and st.lease_expires_at < pg_catalog.now()))
    order by st.due_at
    for update skip locked
    limit p_limit
  ), leased as (
    update internal.scheduled_tasks st
    set status = 'LEASED',
        lease_owner = p_worker_id,
        lease_expires_at = pg_catalog.now() + interval '2 minutes',
        attempts = st.attempts + 1
    from due
    where st.id = due.id
    returning st.id, st.task_type, st.aggregate_id, st.payload
  )
  select leased.id, leased.task_type, leased.aggregate_id, leased.payload from leased;
end
$function$;

grant create on schema internal to drainly_routine_owner;
alter function internal.claim_due_notification_work(text, integer) owner to drainly_routine_owner;
revoke create on schema internal from drainly_routine_owner;

revoke all on function internal.claim_due_notification_work(text, integer) from public, anon, authenticated;
grant execute on function internal.claim_due_notification_work(text, integer) to drainly_system;

commit;
