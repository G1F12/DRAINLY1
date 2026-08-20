# Pilot operations

## Worker

Call `POST /api/internal/jobs/tick` with `Authorization: Bearer <CRON_SECRET>`. The endpoint connects with `DRAINLY_SYSTEM_DATABASE_URL`, leases due work with `SKIP LOCKED`, and processes at most 20 tasks and 20 outbox messages per invocation. Provider calls use deterministic idempotency keys. Leases expire after two minutes. Notification providers share `OUTBOUND_PROVIDER_TIMEOUT_MS` (40 seconds by default and constrained below 60 seconds), leaving more than one minute of lease margin. Resend receives an abort signal and Twilio uses its native request timeout.

Authorization timing is driven by the versioned `authorizationLeadTimeMinutes` setting (2,880 minutes initially). An assignment before the target schedules work at the target; an assignment inside the window or any urgent assignment schedules immediately. No assignment means no destination PaymentIntent.

## Failure handling

- Authorization failures move the current generation to `ACTION_REQUIRED` and enqueue a customer/admin notification.
- Notification failures return the outbox item to `PENDING` with bounded backoff through five attempts. The fifth failure becomes terminal `FAILED`, records only a safe failure code and timestamp, clears its lease, and is excluded from future claims.
- A captured or unreleasable old generation stops automated reassignment.
- Disputes and reconciliation discrepancies create operational alerts and append provider costs without rewriting service history.
- A failed scheduled item is returned to `PENDING` with bounded backoff through five leased attempts. A terminal authorization/capture/cancellation task creates an explicit operational exception without rewriting physical service history.
- `POST /api/admin/outbox/{id}/requeue` accepts only a currently `FAILED` item and requires active TOTP admin authorization, an attributable reason, and an idempotency key. Total attempts, terminal timestamp, safe failure code, requeue count, and provider idempotency key remain preserved.
- `POST /api/admin/orders/{id}/payment-retry` accepts only an open exception for the current non-superseded generation. It requires active TOTP admin authorization and a reason, rejects already successful/invalid/stale operations, audits the assignment/generation/failed task, and creates exactly one task while retaining logical provider idempotency.

## Local provider testing

`PROVIDER_MODE=fake` is the safe default. Fake setup, authorization, capture, refund, transfer-reversal, processing-fee, email, and SMS behavior is deterministic. `FAKE_NOTIFICATION_BEHAVIOR=success|failure|timeout` supports poison-message and timeout tests without network calls. The real payment adapter accepts Stripe test keys only. Do not place real phone numbers or customer email addresses in seed data.

## Database credential provisioning

The migration creates role attributes but does not embed a password. Provision a strong password out-of-band and place only its connection string in the server environment:

```sql
alter role drainly_system password '<secret-from-managed-secret-store>';
```

Rotate the credential by updating the managed secret and PostgreSQL password together. Never expose it to the browser, PostgREST, logs, or analytics.

## Backups and recovery

Production activation requires a tested Supabase/PostgreSQL point-in-time recovery procedure, private Storage recovery, restore validation in an isolated project, key/credential rotation, and a reconciliation run after restore. These remain go-live gates; the repository performs no production backup or recovery action.
