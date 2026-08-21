begin;

grant usage on schema domain to authenticated;
revoke usage on schema domain from anon;

commit;
