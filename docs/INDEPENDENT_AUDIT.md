# Drainly Pilot MVP — Independent Post-Implementation Audit

Audit date: 2026-08-11  
Audited revision: the untracked workspace contents present in `D:\DRAINLY.US` during this audit  
Final verdict: **PASS_WITH_UNVERIFIED_EXTERNAL_GATES**

## Executive conclusion

No unresolved CRITICAL, HIGH, MEDIUM, or actionable LOW finding remains after the independent audit fixes and final hardening pass. The core payment-generation, current-assignment, capture-to-close, database privilege, state-transition, quote-economics, bounded-worker, proof-signature, and recovery invariants are enforced by executable SQL and application code, not by UI serialization.

The verdict is not an unconditional production pass. Supabase Auth, Storage, PostgREST, generated-type drift, and all live provider behavior remain external gates because Docker/Supabase could not start in this environment. The real Stripe adapter intentionally accepts test keys only. Standalone PostgreSQL results do not prove Supabase platform behavior.

The historical four MEDIUM and two LOW findings are retained below with their resolution evidence. Supabase-native and external-provider gates remain unverified; this is not a production-readiness declaration.

## Method and evidence boundary

The audit traced the route handlers, payment adapter, SQL routines, schema constraints, RLS policies, grants, routine ownership, storage policies, tests, seed, and configuration. Existing plans and reports were not used as proof. Database checks were replayed against a fresh PostgreSQL 18 database with minimal test-only Auth/Storage and pgTAP compatibility objects. Product migrations were otherwise executed unmodified except that the unavailable `pgtap` extension declaration was filtered for the standalone replay.

All repository files were initially untracked, so no trustworthy baseline diff existed. Initial audit changes are migration `202608110003_independent_audit_fixes.sql`; final closure is migration `202608110004_final_audit_hardening.sql`, SQL suite 004, the scoped application boundary changes, and the fail-closed verification command.

## Findings fixed during the audit

### HIGH — Resolved: direct quote RPC trusted caller-supplied geography

- Location: `supabase/migrations/202608110001_foundation.sql`, `api.create_quote`; `src/app/api/quotes/route.ts`; fixed by `supabase/migrations/202608110003_independent_audit_fixes.sql:6-10`.
- Failure mode: `anon` or `authenticated` could call the exposed `api.create_quote` RPC directly with a supported `p_region_key` and an unrelated address snapshot. Booking re-evaluated supply/economics but did not re-geocode, so an unsupported address could become a firm booking.
- Reproduction: set role `authenticated` and call `api.create_quote('US-NC-JOHNSTON', ..., '{"stateCode":"CA",...}')`.
- Affected invariant: supported geography must be authoritative; client-submitted location classification cannot be authoritative.
- Fix: revoke quote RPC execution from PostgREST roles, grant it only to constrained `drainly_system`, and call it only after server geocoding through `src/app/api/quotes/route.ts:50`.
- Regression: `supabase/tests/001_security_and_routines.sql` proves both the denial and trusted-server execution.

### HIGH — Resolved: cancellation could orphan an in-flight Stripe authorization

- Location: former `api.cancel_order` and `internal.record_authorization_result`; fixed in `supabase/migrations/202608110003_independent_audit_fixes.sql:63-100` and `:144-200`.
- Failure mode: the worker could commit `AUTHORIZATION_PENDING`, call Stripe outside the transaction, and overlap cancellation. Cancellation previously made the generation non-current when no provider ID had yet been persisted. The worker then could not record the deterministic PaymentIntent and no cancellation task knew its ID, leaving a customer hold orphaned.
- Reproduction: call `internal.begin_authorization`, cancel before `record_authorization_result`, then record an `AUTHORIZED` result.
- Affected invariant: duplicate/racing scheduled authorization and cancellation must not leave untracked financial effects.
- Fix: preserve the current generation while the provider call is in flight; a late result is persisted as `CANCELLATION_PENDING` and creates exactly one deterministic `CANCEL_ORDER_AUTHORIZATION` task.
- Regression: `supabase/tests/003_independent_audit_regressions.sql` executes the overlap and verifies one cancellation task.

### HIGH — Resolved: post-service cancellation could race capture

- Location: former `api.cancel_order`; fixed at `supabase/migrations/202608110003_independent_audit_fixes.sql:144-167`.
- Failure mode: an admin could cancel `SERVICE_COMPLETED` while a capture worker held a stale context. Stripe could capture, while the webhook correctly refused to close the now-canceled order, producing captured funds with a canceled internal order and no normal refund path.
- Reproduction: lease a `CAPTURE_PAYMENT` task, call admin cancellation after its context read, then let capture complete.
- Affected invariant: capture/cancellation races cannot diverge provider and order state; completed service needs an explicit recoverable payment state.
- Fix: cancellation is forbidden once service is completed. Capture must settle first; any customer return then uses the bounded refund lifecycle.
- Regression: `supabase/tests/003_independent_audit_regressions.sql` verifies `ORDER_NOT_CANCELLABLE_AFTER_SERVICE`.

### HIGH — Resolved: failed access/service retained authorization and capacity

- Location: `api.transition_job`; fixed by `internal.release_failed_order_payment` at `supabase/migrations/202608110003_independent_audit_fixes.sql:102-129` and the broadened late-authorization handling at `:63-100`.
- Failure mode: `FAIL_ACCESS` and `FAIL_SERVICE` changed only the order status. An authorized hold and active assignment could remain indefinitely; an in-flight authorization could still arrive after failure.
- Reproduction: authorize a scheduled order, call `transition_job(..., 'FAIL_SERVICE', ...)`, then inspect the current payment generation and assignment.
- Affected invariant: failure states must not retain customer holds or consume contractor capacity; late provider results must be canceled.
- Fix: a database trigger releases the assignment and either cancels the not-yet-created generation or queues provider cancellation. In-flight results are persisted and canceled deterministically.
- Regression: `supabase/tests/003_independent_audit_regressions.sql` verifies both released capacity and `CANCELLATION_PENDING`.

### HIGH — Resolved: pending Stripe refunds had no terminal webhook path

- Location: `src/app/api/webhooks/stripe/route.ts:36-45`, `src/modules/payments/gateway.ts`, and `internal.process_refund_webhook` at `supabase/migrations/202608110003_independent_audit_fixes.sql:205-241`.
- Failure mode: a synchronous refund returning `pending` completed its worker task, but refund webhooks were ignored. The refund and actual transfer reversal could therefore remain absent from the ledger indefinitely.
- Affected invariant: partial/full refund and transfer-reversal accounting must converge without duplicate effects.
- Fix: retrieve terminal refund/reversal facts from Stripe, deduplicate the event in `internal.webhook_events`, and advance only `REQUESTED`/`PENDING` refunds. Existing unique provider references and status guards prevent duplicate ledger effects.
- Regression: `supabase/tests/002_privileged_routine_matrix.sql` now records a pending response and advances it through `refund.updated`.

## Findings resolved during final audit hardening

### MEDIUM — Resolved: firm bookings do not reserve capacity represented by outstanding offers

- Location: `api.create_quote` around `supabase/migrations/202608110001_foundation.sql:891-906`; `api.create_booking` around `:1027-1047`; acceptance lock at `:1122-1128`.
- Failure mode: quote and booking capacity counts only active assignments. Multiple customers can concurrently receive/book firm quotes against the same final slot because outstanding offers are not reservations. Acceptance remains safe—`contractor_day_capacity` serialization permits only one winner—but later customers can be left searching after a firm booking.
- Reproduction: with contractor capacity one and zero assignments, concurrently create and book two quotes before either offer is accepted; both bookings can create offers, while only one offer can later be accepted.
- Affected invariant: booking re-evaluates current capacity but does not reserve it; the stronger interpretation of “firm” supply is not guaranteed across concurrent bookings.
- Resolution: the pilot contract is explicit in customer UI, fake endpoints, and notification templates: `PRICED` locks price but not capacity/date; booking remains `SEARCHING_CONTRACTOR`; only `SCHEDULED` and later are confirmed-service states. Atomic acceptance is unchanged.
- Regression: `tests/unit/customer-presentation.test.ts`, `tests/unit/worker-hardening-static.test.ts`, and `supabase/tests/004_final_audit_hardening.sql` prove two searching orders can coexist, only the accepted order becomes scheduled, the other remains searching, and the capacity loser is rejected.

### MEDIUM — Resolved: outbox failures have no poisoned-message terminal state

- Location: `internal.complete_outbox`, `supabase/migrations/202608110002_operations.sql:759-769`.
- Failure mode: every failed notification returns to `PENDING`; attempts and backoff grow but the message never becomes `FAILED`. A permanently malformed recipient/provider response is retried forever.
- Reproduction: make the notification provider deterministically reject one leased message and repeatedly tick the worker.
- Affected invariant: poisoned jobs and retry limits must be explicit.
- Resolution: retry attempts are bounded by the centralized five-attempt limit. Exhaustion records `FAILED`, `failed_at`, a safe failure code, and preserved attempts. `api.requeue_failed_outbox` is FAILED-only, active-TOTP-admin-only, reason-required, and audited; it resets only the retry cycle and preserves history/provider idempotency.
- Regression: `supabase/tests/004_final_audit_hardening.sql` proves five failures, no sixth claim, redaction, authorized/unauthorized requeue, preserved history, and successful post-requeue convergence.

### MEDIUM — Resolved: declared proof MIME need not match the accepted magic signature

- Location: `hasValidMagicBytes` and finalization at `src/app/api/proofs/route.ts:31-36` and `:71-75`.
- Failure mode: a PNG body stored with `image/jpeg` metadata passes because the code independently checks metadata equality and accepts any supported signature rather than the signature for the declared type.
- Reproduction: upload PNG bytes to a registered `.jpg` proof path with JPEG content type and matching checksum/size.
- Affected invariant: file type and magic-byte validation must agree.
- Resolution: `hasValidMagicBytes(bytes, expectedMime)` requires the exact registered JPEG/PNG/WebP signature. Filename extension remains non-authoritative; proof registration, private storage, checksum, size, assignment authorization, and download controls are unchanged.
- Regression: `tests/unit/proof-signature.test.ts` covers matching types, cross-MIME rejection, random bytes, and unsupported MIME. Reassignment proof-access coverage remains in `tests/unit/database-security-static.test.ts`.

### MEDIUM — Resolved: exhausted payment jobs leave aggregate state without an application retry command

- Location: `internal.complete_work`, `supabase/migrations/202608110001_foundation.sql:1316-1327`; worker errors in `src/app/api/internal/jobs/tick/route.ts:113-119`.
- Failure mode: after five failures the task becomes `FAILED`, but an authorization can remain `AUTHORIZATION_PENDING` or a completed-service payment can remain `CAPTURE_PENDING`. The state is visible in the database, but no bounded admin RPC requeues it.
- Reproduction: make Stripe authorization/capture fail for five leased attempts.
- Affected invariant: provider failures after physical service need an explicit, recoverable operational state.
- Resolution: terminal authorization/capture/cancellation tasks create linked `payment_operation_exceptions` and an admin attention flag while preserving physical service state. `api.retry_failed_payment_operation` validates TOTP admin, reason, current assignment/generation, non-supersession, logical validity, provider/ledger success evidence, and active retry absence before creating one task. Stripe logical idempotency remains generation-based; no admin state-setting command exists.
- Regression: `supabase/tests/004_final_audit_hardening.sql` proves five failures/no sixth claim, actor/MFA/reason denials, one idempotent retry, superseded denial, provider-confirmed capture, completed-service close, duplicate webhook harmlessness, one capture ledger effect, audit evidence, and exception resolution.

### LOW — Resolved: standalone test command skips database integration without explicit configuration

- Location: `tests/integration/contractor-acceptance.test.ts:4-5`, `package.json` test scripts.
- Failure mode: `pnpm test` passes with the database suite skipped if `TEST_DATABASE_URL` is absent.
- Resolution: `pnpm test` is unit/static only. `pnpm test:integration` first requires and connects to `TEST_DATABASE_URL`; missing or unavailable configuration exits nonzero. The concurrency test also throws if directly invoked without the URL. CI invokes this fail-closed command.
- Evidence: the command exited 1 with a concise required-variable message when absent and passed against PostgreSQL 18 when configured.

### LOW — Resolved: outbox lease duration is fixed while provider latency is unbounded

- Location: `internal.claim_outbox`, `supabase/migrations/202608110002_operations.sql:683-700`.
- Failure mode: a provider call lasting over two minutes permits a second lease. Notification idempotency keys prevent duplicate effects only if the provider honors them.
- Resolution: the 120-second lease is paired with one centralized 40-second timeout. Resend is aborted with `AbortSignal`; Twilio uses its native timeout; fake providers simulate timeout. Timeout enters the bounded outbox lifecycle and retains notification idempotency.
- Regression: `tests/unit/notification-timeout.test.ts`, `tests/unit/worker-hardening-static.test.ts`, and `supabase/tests/004_final_audit_hardening.sql` prove abort before half the lease, no competing claim during a valid lease, retry flow, and terminal `FAILED` after permanent timeout.

## Invariant results

### Payments

- Customer total and contractor payout are separate immutable snapshot columns. `destinationPaymentIntentParams` sets PaymentIntent `amount = customerTotalCents` and `transfer_data.amount = contractorPayoutCents` (`src/modules/payments/model.ts:34-49`).
- `application_fee_amount` is absent from migrations and production intent parameters; the fake gateway also rejects it.
- Database checks require payout ≤ total, transfer amount = payout, and retained gross = total − payout (`supabase/migrations/202608110001_foundation.sql:359-397`).
- Firm quote, booking, acceptance, and reassignment each recompute processing estimate, payout funding, and minimum contribution. Amounts supplied by browser booking/quote payloads are not accepted.
- Each assignment has a unique payment generation; one partial unique index enforces one current generation per order. Reassignment cancels/supersedes the old generation before creating the replacement.
- Capture workers require current `CAPTURE_PENDING`; capture closure additionally requires current generation, `SERVICE_COMPLETED`, and authoritative `payment_intent.succeeded`. Old-generation webhooks cannot close the order.
- Webhook receipts, provider IDs, ledger references, refund IDs, scheduled task keys, and provider idempotency keys bound duplicate effects. Reconciliation reads actual Stripe balance-transaction fees and keeps them distinct from gross retained funds and contractor marketplace fees.

### Concurrency

- Offer acceptance locks offer then order. The active-assignment, accepted-offer, current-generation, and assignment-generation unique constraints are structural fallbacks.
- Capacity acceptance/reassignment serializes on `contractor_day_capacity` before recounting active assignments.
- Authorization is compare-and-set by `internal.begin_authorization`; stale generations return `shouldRun=false`. Reassignment/cancellation preserve an in-flight generation until the provider result is known and canceled.
- Work/outbox leasing uses `FOR UPDATE SKIP LOCKED`, owner-bound completion, lease expiry, deterministic provider keys, and a centralized five-attempt ceiling. Terminal outbox/payment work is explicit and recoverable only through audited narrow commands.
- No external provider call occurs inside a database transaction. Provider calls are bracketed by narrow claim/result routines.

### Authorization and privileges

- Supabase configuration exposes only `api` (`supabase/config.toml:13`). `domain` and `internal` are not PostgREST schemas.
- PUBLIC is revoked from schemas/functions; domain/internal tables use forced RLS. Authenticated roles have select-only underlying grants plus explicitly allowlisted API routines and cannot directly mutate protected tables.
- `drainly_system` is login, NOBYPASSRLS, and can execute only allowlisted internal operations. `drainly_routine_owner` is NOLOGIN/NOBYPASSRLS, owns no schema/table, has an explicit table privilege allowlist, and every privileged routine fixes `search_path=''`.
- Customer, contractor-company, and admin isolation is implemented through RLS-backed security-invoker views. Admin mutations require active admin membership, `aal2`, a TOTP AMR entry, reason, and audit record.
- The SQL privilege suites passed direct-table-denial and intended-operation tests for all privileged routines.

### State correctness

- Contractor transitions are `SCHEDULED → EN_ROUTE → ARRIVED → SERVICE_COMPLETED`; failures are accepted only from scheduled/en-route/arrived. Unattended completion requires verified proof.
- EN_ROUTE requires `AUTHORIZED` unless the dedicated admin TOTP override set the generation flag and audit/event records.
- Only the current captured generation can close an order, and only from `SERVICE_COMPLETED`.
- Failed access/service releases assignment and authorization. Capture exhaustion preserves `SERVICE_COMPLETED`/`CAPTURE_PENDING`, creates an operational exception, and can close only after a valid TOTP-admin retry plus provider confirmation.

### Quote integrity

- `PRICED` requires active supported region, known tank tier, active regional/contractor price rules, approved Connect-ready contractor, weekday/urgent availability, no blackout, apparent capacity, payout funding, estimated processing cost, and minimum net contribution.
- Booking and acceptance recompute active settings, contractor price/fee, availability, capacity, payout, processing estimate, and net guardrail. Reassignment does the same for the replacement.
- The trusted server-only quote path closes geography forgery. Outstanding offers remain non-reservations by explicit pilot contract; price is firm, while the service date is confirmed only by atomic acceptance.

### Proof and PII

- The bucket is private with 10 MiB and MIME restrictions. Registration binds current active assignment, order path, checksum, size, MIME, uploader, and idempotency. Finalization downloads through the caller's RLS-bound Storage client, then system verification checks size/checksum/signature.
- Released contractors are excluded from Storage reads; customers and active admins retain order proof access. Signed download URLs expire after 60 seconds and responses are `private, no-store`.
- Structured logging recursively redacts email, phone, address, notes, credentials, payment-method, provider-payload, and authorization fields. PostHog disables autocapture/session recording and emits only pathname.
- MIME-specific signature cross-matching rejects declared/actual JPEG, PNG, and WebP mismatches without changing proof access controls.

## Verification results

| Verification | Result | Evidence / limitation |
|---|---|---|
| Clean dependency install | PASS | `pnpm install --frozen-lockfile`; lockfile current. pnpm reported intentionally ignored dependency build scripts for Sentry CLI/core-js. |
| Typecheck | PASS | `pnpm typecheck`. |
| Lint | PASS | `pnpm lint`. |
| Unit/static tests | PASS | `pnpm test:unit`: 11 files, 52 tests. |
| Default test command | PASS | `pnpm test` is explicitly unit/static only; it does not discover or silently skip database tests. |
| Missing integration configuration | EXPECTED_FAIL | `pnpm test:integration` without `TEST_DATABASE_URL` exited 1 with a concise required-variable error. |
| PostgreSQL integration/concurrency | PASS | Real two-session acceptance race: one winner, one active assignment, one accepted offer, one current generation. |
| Database tests | PASS | All four SQL suites reached `ok - finish` after clean replay. |
| Migration replay | PASS (PostgreSQL only) | Fresh PostgreSQL 18 replay of migrations 001–004 with test-only Auth/Storage/pgTAP shims. |
| Seed replay | PASS | Seed applied twice without error. |
| Production build | PASS | `pnpm build`; all routes compiled and page generation completed. |
| Playwright | PASS | 6/6 desktop/mobile system-Chrome tests. Development CSP emitted expected React eval warnings only. |
| Secret scan | PASS | 123 repository files checked with no detected secret. |
| Supabase start/reset/test | BLOCKED | Docker Desktop API returned HTTP 500 before containers could start; `supabase test db` then had no local database. |
| Generated Supabase type drift | BLOCKED | `pnpm db:types:check` requires the unavailable local Supabase container. Checked-in types compile but are not generated-drift proof. |

## Unverified external gates

- Supabase Auth token claims, TOTP AMR shape, Storage signed upload/download behavior, and PostgREST schema/execute enforcement on the actual platform.
- Stripe Connect destination-charge behavior, webhook delivery ordering, refund/reversal objects, actual balance-transaction fees, dispute events, and production-country/account eligibility. Only test keys are accepted by this implementation.
- Live Google Maps normalization, Resend/Twilio delivery, PostHog/Sentry transport, deployment headers, backups, restore, monitoring, and operational credentials.

These gates are the reason the verdict is not `PASS`.

PASS_WITH_UNVERIFIED_EXTERNAL_GATES

## Supabase-native verification remediation (2026-08-11)

The historical Docker/Supabase failures recorded above are retained as the original audit evidence. Docker and the local Supabase stack are now operational. A clean native run first exposed three compatibility defects: pgTAP assertions were invoked after switching into application roles that could not use the `extensions` schema; SECURITY DEFINER routines depended directly on `auth.uid()`/`auth.jwt()` even though Supabase Auth reapplies the native `auth` schema ACL; and the checked-in TypeScript file was a handwritten placeholder rather than current generated output.

The scoped remediation was:

- SQL tests grant `extensions` schema usage to `authenticated` and `drainly_system` only inside each test transaction, which ends with `ROLLBACK`. No production role receives persistent pgTAP access.
- The non-exposed `identity.uid()` and `identity.jwt()` bridge functions are owned by the native `postgres` role, are SECURITY DEFINER with an empty search path, and delegate only to the corresponding supported Auth helper. PUBLIC execution is revoked; `drainly_routine_owner` receives only `USAGE` on `identity` and EXECUTE on these two functions. It retains no `auth` schema or `auth.users` table privilege.
- All Drainly privileged routines use that bridge consistently. Native tests cover authenticated acceptance, unauthenticated denial, other-company denial, direct-table denial, constrained owner attributes, and the one-winner capacity invariant.
- `pnpm db:types` regenerated the configured `api,domain` type surface. Inspection confirmed only `api` and `domain` schemas, the expected API views/RPCs and domain enums/tables, and no `auth`, `identity`, or `internal` schema surface. Supabase clients now specify the `api` schema generic explicitly, and view consumers fail closed on unexpectedly null key/state/value columns.

Exact remediation verification results:

| Command / check | Result |
|---|---|
| `supabase db reset` | PASS; roles, migrations 001-004, and seed replayed on local Supabase. |
| `supabase test db` | PASS; 4 files, 168 tests. |
| `pnpm db:types` | PASS; authoritative local `api,domain` types generated. |
| Generated type inspection | PASS; only `api` and `domain`; expected views/RPCs/enums/tables; no `auth`, `identity`, or `internal` schema. |
| `pnpm db:types:check` | PASS; generated output matches the checked-in file. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS with zero warnings; native `supabase/.temp` output is excluded. |
| `pnpm test:unit` | PASS; 11 files, 54 tests. |
| Targeted hardening tests | PASS; 5 files, 23 tests. |
| `pnpm test:integration` with local Supabase URL | PASS; 1 file, 1 two-session database test. |
| Direct contractor acceptance concurrency test | PASS; exactly one winner. |
| `pnpm test:e2e` | PASS; 6/6 Chromium desktop/mobile tests. Development-only React CSP/eval warnings were emitted. |
| `pnpm build` | PASS; production compilation, type checking, and 18-page generation completed. |
| `pnpm scan:secrets` | PASS; 125 files checked. |
