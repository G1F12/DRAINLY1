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

  select * into strict role_state from pg_catalog.pg_roles where rolname = 'drainly_system';
  if role_state.rolsuper or role_state.rolcreatedb or role_state.rolcreaterole
    or role_state.rolreplication or role_state.rolbypassrls or not role_state.rolcanlogin
  then
    raise exception 'Unsafe role attributes for drainly_system; repair the cluster-level role before bootstrap';
  end if;

  select * into strict role_state from pg_catalog.pg_roles where rolname = 'drainly_routine_owner';
  if role_state.rolsuper or role_state.rolcreatedb or role_state.rolcreaterole
    or role_state.rolreplication or role_state.rolbypassrls or role_state.rolcanlogin
  then
    raise exception 'Unsafe role attributes for drainly_routine_owner; repair the cluster-level role before bootstrap';
  end if;
end
$roles$;

grant drainly_system to postgres with inherit false, set true;
grant drainly_routine_owner to postgres with inherit true, set true;
