# Drainly Pilot MVP — Final Audit Hardening Report

Date: 2026-08-11  
Verdict: **PASS_WITH_UNVERIFIED_EXTERNAL_GATES**

## Scope and result

The six historical actionable findings in `docs/INDEPENDENT_AUDIT.md` are closed at code level with migration `202608110004_final_audit_hardening.sql`, scoped application changes, and regression coverage. Previously resolved HIGH findings and payment/assignment/RLS invariants remain covered. This is not a production-readiness verdict.

## Changes by finding

1. Firm booking semantics: `PRICED` means locked price plus currently viable supply, never reserved capacity or a confirmed date. Booking remains `SEARCHING_CONTRACTOR`; customer UI, fake responses, and notification copy confirm the date only after atomic acceptance.
2. Poison outbox: five-attempt ceiling, bounded backoff, terminal `FAILED`, safe failure code/timestamp, FAILED-only TOTP-admin requeue with reason, preserved attempts/failure/provider key, and immutable audit record.
3. Proof MIME: JPEG, PNG, and WebP signatures must match the declared MIME exactly; proof authorization/storage/checksum/size/access controls are unchanged.
4. Financial recovery: terminal authorization/capture/cancellation tasks create linked operational exceptions without rewriting physical service state. One TOTP-admin/reason-required/idempotent command validates current assignment/generation, provider evidence, logical validity, and non-supersession before creating a task with the same logical Stripe key.
5. Fail-closed integration: `pnpm test:integration` requires a reachable `TEST_DATABASE_URL`; direct concurrency-test invocation also fails without it. Unit/static testing is separate.
6. Provider timeout: centralized 40-second notification timeout under the 120-second lease; Resend abort signal, Twilio native timeout, deterministic fake timeout, and bounded retry/FAILED flow.

## Primary files

- Migration and SQL regression: `supabase/migrations/202608110004_final_audit_hardening.sql`, `supabase/tests/004_final_audit_hardening.sql`
- Worker/adapters: `src/app/api/internal/jobs/tick/route.ts`, `src/modules/notifications/gateway.ts`, `delivery-limits.ts`, `templates.ts`
- Recovery routes: `src/app/api/admin/outbox/[id]/requeue/route.ts`, `src/app/api/admin/orders/[id]/payment-retry/route.ts`
- Proof: `src/modules/proofs/signature.ts`, `src/app/api/proofs/route.ts`
- Customer semantics: `src/modules/orders/customer-presentation.ts`, customer/book UI, fake order endpoint
- Verification: `scripts/require-test-database.mjs`, `package.json`, CI workflow, README

## Regression coverage added

- `tests/unit/proof-signature.test.ts`
- `tests/unit/customer-presentation.test.ts`
- `tests/unit/notification-timeout.test.ts`
- `tests/unit/worker-hardening-static.test.ts`
- expanded `tests/unit/database-security-static.test.ts`
- repeatable `tests/integration/contractor-acceptance.test.ts`
- `supabase/tests/004_final_audit_hardening.sql`

## Commands executed and exact results

| Command / check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile current. pnpm reported intentionally ignored Sentry CLI/core-js build scripts. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS with zero warnings. |
| `pnpm test:unit` | PASS: 11 files, 52 tests. |
| Targeted hardening Vitest files | PASS: 5 files, 21 tests. |
| `pnpm build` | PASS; Next.js 16.3 production build compiled all pages/routes. |
| `pnpm scan:secrets` | PASS: 123 files checked. |
| `pnpm test:integration` without `TEST_DATABASE_URL` | EXPECTED FAIL, exit 1 with required-variable message. |
| Configured `pnpm test:integration` | PASS against PostgreSQL 18: real two-session acceptance race. |
| Fresh PostgreSQL 18 migration replay | PASS: migrations 001–004 from a new database with minimal Auth/Storage shims; unavailable pgTAP declaration omitted. |
| Seed replay | PASS: seed applied twice. |
| PostgreSQL SQL suites 001–004 | PASS: all reached `ok - finish` and rolled back. |
| `pnpm test:e2e` | PASS: 6/6 desktop/mobile Chrome tests; expected development React CSP/eval warnings only. |
| `supabase start` | BLOCKED: Docker Desktop API HTTP 500 while inspecting `supabase_db_DRAINLY.US`. |
| `supabase db reset` | BLOCKED by the same Docker HTTP 500 before containers started. |
| `pnpm test:db` | BLOCKED: no local Supabase PostgreSQL at `127.0.0.1:54322`. |
| `pnpm db:types:check` | BLOCKED by the Docker/Supabase inspection failure. |

## Focused adversarial review

Changed code was reviewed for stale/superseded generations, duplicate admin commands, duplicate/stale webhooks, leaked provider errors, lease overlap, post-service truthfulness, misleading customer language, operational-alert routing, and generic state mutation. Follow-up fixes changed the fake order endpoint from fabricated `SCHEDULED` to `SEARCHING_CONTRACTOR`, added direct admin recovery UI, made the timeout error win its abort race, and routed terminal payment alerts only to operations.

## Remaining unverified gates

- Supabase Auth claim/TOTP shape, Storage policies, PostgREST enforcement, and generated type drift on the actual stack.
- Live Stripe Connect/webhook behavior, Resend, Twilio, Maps, telemetry, backups/restore, deployment headers, and production credentials.

Code-level audit state: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 actionable LOW**. External/platform gates remain unverified, so the verdict is **PASS_WITH_UNVERIFIED_EXTERNAL_GATES**.

## Supabase-native remediation addendum (2026-08-11)

The blocked and failed native runs above remain the historical record. Docker/Supabase startup is now functional, and a successful `supabase db reset` exposed three real native differences: pgTAP was being called while the session was an application role without `extensions` usage, Supabase Auth restored an `auth` schema ACL that excluded the routine owner, and generated database types had drifted from the handwritten placeholder.

Applied fixes were deliberately narrow:

- pgTAP access is granted only inside rollback-only SQL test transactions.
- Two non-exposed, PUBLIC-revoked identity bridge functions provide only trusted `auth.uid()` and `auth.jwt()` results. The NOLOGIN/NOSUPERUSER/NOBYPASSRLS routine owner has EXECUTE on those functions but no `auth` schema or table access.
- All privileged routines use the same trusted bridge; actor IDs are never accepted from callers. Acceptance tests cover authenticated success, missing identity, another company, direct mutation denial, and one-winner concurrency.
- Types were regenerated using `pnpm db:types`. The checked-in output contains only the configured `api` and `domain` schemas, including expected API RPCs/views and domain references; it contains no `auth`, `identity`, or `internal` schema. API clients explicitly select the `api` schema type.

| Command / check | Result |
|---|---|
| `supabase db reset` | PASS; migrations 001-004 and seed replayed. |
| `supabase test db` | PASS; 4 files, 168 tests. |
| `pnpm db:types` and generated diff inspection | PASS; intended `api,domain` surface only. |
| `pnpm db:types:check` | PASS. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS with zero warnings. |
| `pnpm test:unit` | PASS; 11 files, 54 tests. |
| Targeted hardening tests | PASS; 5 files, 23 tests. |
| Configured integration suite | PASS; local Supabase, 1/1. |
| Direct two-session concurrency test | PASS; exactly one acceptance winner. |
| `pnpm test:e2e` | PASS; 6/6. |
| `pnpm build` | PASS. |
| `pnpm scan:secrets` | PASS; 125 files checked. |
