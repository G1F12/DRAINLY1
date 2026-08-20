# Architecture

## Runtime shape

Drainly is one Next.js App Router application. Route handlers provide the HTTP boundary; `src/modules` contains transport-independent pricing, dispatch, order-state, and payment logic. PostgreSQL is authoritative for identities, eligibility, money, assignment, service state, idempotency, and audit history.

External work follows an outbox/task boundary:

```text
HTTP command -> privileged database routine -> immutable event + task/outbox
worker lease -> external test/fake provider -> result routine -> ledger/audit/event
```

No external provider is called inside a database transaction.

## Firm price versus confirmed service date

`PRICED` means the customer total is firm and current marketplace supply is viable. Outstanding quotes and offers do not reserve contractor capacity. A booked order therefore remains `SEARCHING_CONTRACTOR`; customer UI and notification templates describe its price as locked and its requested date as pending provider confirmation. Only atomic contractor acceptance may create the active assignment/payment generation and move the normal order to `SCHEDULED`, the first confirmed-service state. Multiple searching orders may coexist against apparent final capacity, while the existing contractor/day lock still permits only an under-capacity acceptance winner.

## Schema boundary

- `api`: the only PostgREST-exposed schema. It contains security-invoker views and named command routines.
- `domain`: authoritative business tables and immutable history. It is not exposed through the Data API.
- `internal`: webhook receipts, setup verification, scheduled tasks, outbox, payment attempts, reconciliation, disputes, and HMAC-keyed rate-limit state. It is not exposed.

`authenticated` and `anon` have only selected API privileges. `drainly_system` is a constrained server-only login with execute permission on named worker routines and no direct protected-table mutation. `drainly_routine_owner` is non-login/NOBYPASSRLS, owns only approved privileged routines, and receives explicit table grants plus RLS policies; it owns no schema, table, or sequence.

## Payment and assignment generations

Each assignment owns exactly one contractor-specific payment generation. Its destination account and immutable economics are copied when the generation is created. Authorization uses a manual-capture destination PaymentIntent:

```text
amount = customerTotalCents
transfer_data[destination] = assignment connected account
transfer_data[amount] = contractorPayoutCents
```

No `application_fee_amount` is produced. Reassignment releases the old assignment, cancels any uncaptured authorization, confirms release, supersedes that generation, then creates a new generation and authorizes the replacement destination. Authorization work is atomically claimed before the provider boundary; stale tasks are skipped, while a reassignment that overlaps an in-flight authorization waits for the deterministic result and routes that intent to cancellation. Capture requires the current generation and active assignment.

## Historical economics

Quote candidates, offers, and payment generations persist their versioned inputs and exact integer-cent terms. Quote estimates are never substituted for actual fees. Reconciliation appends provider fee ledger entries and derives actual transaction net from captures, refunds, transfers, reversals, and provider fees. Configuration changes never rewrite historical values.

Terminal payment-worker failures create explicit `payment_operation_exceptions` linked to the order, assignment, current payment generation, and failed task. This exception is independent of physical service state: for example, `SERVICE_COMPLETED` remains truthful while the admin view reports `requires_admin_attention`. The only recovery command validates the current non-superseded generation, assignment, operation-specific provider evidence, active TOTP admin, reason, and idempotency before atomically creating a fresh task. The task keeps the same logical Stripe key (`authorize:`, `capture:`, or `cancel:` plus generation ID); no command can manually set a provider-confirmed payment state.

## Authentication and proof storage

Customers authenticate with verified email OTP. Contractor and admin authority comes only from invitation-created membership rows; admin financial commands additionally require an `aal2` TOTP session. Proofs live in a private Supabase Storage bucket. Preparation checks assignment authority; finalization obtains the expected path, size, MIME type, and checksum through a system routine before validating bytes and magic signatures. Downloads use a 60-second signed URL after storage RLS authorization.
