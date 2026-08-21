begin;

grant usage on schema identity to authenticated;
grant execute on function identity.uid() to authenticated;
grant execute on function identity.jwt() to authenticated;

revoke usage on schema identity from anon;
revoke execute on function identity.uid() from anon;
revoke execute on function identity.jwt() from anon;

commit;
