# ADR 001: Database exposure and privileged routines

Status: accepted.

Only `api` is exposed through PostgREST. Authoritative and infrastructure schemas remain private. Protected commands are security-definer routines with empty search paths, fully qualified references, public execution revoked, internal actor/precondition checks, and named execute grants.

`drainly_system` is a least-privilege login for trusted server work. `drainly_routine_owner` is a separate non-login owner for approved routines only; explicit grants and forced-RLS policies provide its access. This avoids service-role JWT bypass, broad table writes, accidental table-owner bypass, and mutable search-path attacks.
