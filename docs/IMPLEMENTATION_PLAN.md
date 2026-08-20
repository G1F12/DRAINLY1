# Drainly US Pilot MVP — Approved Implementation Plan

## Objective and locked architecture

Build a production-oriented modular monolith for the Johnston and Harnett County pilot with Next.js App Router, strict TypeScript, PostgreSQL/Supabase, private Supabase Storage, and Stripe Connect. Regional customer prices and contractor payout economics remain separate. Firm quotes require supported geography, a valid regional price, currently eligible supply, a fully funded contractor payout, a conservative processing-cost reserve, and the configured minimum net contribution.

The application is organized by identity, customers, properties, contractors, geography, pricing, quotes, orders, dispatch, payments, proofs, notifications, admin, audit, analytics, and provider adapters. Domain logic stays independent of React and HTTP. SQL migrations and generated database types are authoritative; no ORM is used. Transactional outbox and scheduled work isolate database transactions from external providers. Production deployment and live provider operations are excluded.

## Database exposure, roles, and privileged routines

Use `api` as the only Supabase Data API schema, `domain` for non-exposed business data, and `internal` for non-exposed webhook, outbox, scheduling, rate-limit, lease, and reconciliation state. Revoke default privileges, expose only narrow security-invoker views and routines, and combine RLS with least-privilege grants.

Create `drainly_system` as a server-only PostgreSQL login with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It uses `DRAINLY_SYSTEM_DATABASE_URL`; it does not use a Supabase service-role JWT as a generic business-operation bypass. Grant only required schema usage and execution on named trusted routines, with no broad protected-table mutation privileges.

Create `drainly_routine_owner` as `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It owns only the explicitly privileged `SECURITY DEFINER` routines. It owns no schema, protected table, sequence, or unrelated function and receives only the exact grants and explicit RLS policies needed by those routines. Its behavior must never depend on table ownership or accidental RLS bypass.

Every privileged routine uses `SECURITY DEFINER SET search_path = ''`, fully qualified names, revoked public/default execution, minimum-role execution grants, and in-transaction actor and business-precondition validation. Database tests must prove, for every privileged routine, that an authorized invocation performs exactly its intended protected mutation while the same invoker cannot perform the underlying mutation directly. Tests also cover unauthorized calls, safe search paths, role attributes, routine ownership, explicit RLS behavior, and effective-grant allowlists.

## Domain, money, quote, and order invariants

Model customers, properties, contractor companies and users, admins, verifications, reusable service regions, coverage, availability, blackout dates, capacity, versioned regional and contractor price books, marketplace settings, quotes and advisory candidates, orders, offers, assignment history, payment generations and attempts, refunds, financial ledger entries, order events, proofs, notifications, audits, admin notes, webhook receipts, outbox, scheduled tasks, reconciliation, leases, and rate-limit state.

Persist integer cents for `customerSubtotalCents`, `customerFeeCents`, `customerTotalCents`, `contractorGrossCents`, `contractorMarketplaceFeeCents`, `contractorPayoutCents`, `stripeTransferAmountCents`, `platformGrossRetainedCents`, `estimatedPaymentProcessingCostCents`, actual `stripeProcessingFeeCents`, `platformPricingAdjustmentCents`, `expectedPlatformNetContributionCents`, and reconciled `actualPlatformNetTransactionCents`.

```text
customerTotalCents = customerSubtotalCents + customerFeeCents
contractorMarketplaceFeeCents = configured fee applied to contractorGrossCents
contractorPayoutCents = contractorGrossCents - contractorMarketplaceFeeCents
stripeTransferAmountCents = contractorPayoutCents
platformGrossRetainedCents = customerTotalCents - contractorPayoutCents
estimatedPaymentProcessingCostCents =
  ceil(customerTotalCents * estimatedProcessingRateBps / 10_000)
  + estimatedProcessingFixedCents
expectedPlatformNetContributionCents =
  customerTotalCents - contractorPayoutCents
  - estimatedPaymentProcessingCostCents
```

The processing estimate is a versioned conservative quote reserve, not the final Stripe fee. Actual platform economics derive from immutable capture, refund, transfer, reversal, processing-fee, dispute-fee, and provider-fee ledger entries. `contractorMarketplaceFeeCents` is a contractual concept and need not equal retained funds. Automated payout must always be less than or equal to customer total; pilot v1 contains no platform-funded contractor subsidy.

Return `PRICED` only for supported geography with a regional rule and at least one currently eligible, available, under-capacity, Connect-ready contractor whose payout is fully funded and whose expected net contribution meets `minimumContributionMarginCents`. Return `UNSUPPORTED`, `UNAVAILABLE`, or `REVIEW_REQUIRED` otherwise. A fully audited admin override may reduce the minimum margin but never the payout-funding constraint. Quote candidates are advisory; booking, dispatch, and acceptance re-evaluate eligibility and economics. Quotes expire after 30 minutes.

Service states are `SEARCHING_CONTRACTOR`, `SCHEDULED`, `EN_ROUTE`, `ARRIVED`, `SERVICE_COMPLETED`, `CLOSED`, `CANCELLED`, `FAILED_ACCESS`, `FAILED_SERVICE`, `REASSIGNMENT_PENDING`, and `NEEDS_ADMIN_REVIEW`. Payment-generation states are `REQUESTED`, `AUTHORIZATION_SCHEDULED`, `AUTHORIZATION_PENDING`, `AUTHORIZED`, `CAPTURE_PENDING`, `CAPTURED`, `ACTION_REQUIRED`, `FAILED`, `CANCELLATION_PENDING`, `CANCELLED`, and `SUPERSEDED`. State changes validate actor, assignment, current generation, and preconditions and append immutable events atomically.

## Dispatch, authorization, and Stripe

Scheduled offers are sequential with 30-minute expiry. Urgent offers fan out to at most three contractors for 10 minutes. Rank by admin priority, service-date utilization, then contractor UUID. Atomic acceptance locks the order, offer, and contractor/date capacity; rechecks all eligibility and economics; creates one active assignment and payment-generation request; closes competing offers; and emits event/outbox work. Constraints enforce one accepted offer, one active assignment, and one current payment generation.

Version `authorizationLeadTimeMinutes` (initially 2,880), `estimatedProcessingRateBps`, `estimatedProcessingFixedCents`, and `minimumContributionMarginCents`. An assignment before the authorization target schedules authorization for the target. Assignment at or after the target, or urgent assignment, authorizes immediately. Without an assignment, create no destination PaymentIntent. A later assignment authorizes immediately. Contractors cannot transition to `EN_ROUTE` or later without an `AUTHORIZED` current generation except through a dedicated audited admin override.

Create manual-capture destination PaymentIntents with:

```text
amount = customerTotalCents
transfer_data[destination] = current assignment connected account
transfer_data[amount] = contractorPayoutCents
capture_method = manual
```

Never calculate or send `application_fee_amount`. Persist Stripe's `capture_before`. Capture only the current assignment's current authorized generation after valid completion; authoritative webhook processing or reconciliation finalizes payment state.

Every reassignment creates a new payment generation. Supersede a generation without a PaymentIntent immediately. Cancel/release an existing uncaptured authorization with an idempotency key and confirm cancellation before supersession. Create a new PaymentIntent targeting the replacement connected account; the replacement cannot begin service before authorization except through audited override. Captured or unreleasable old payments stop automated reassignment and create an exception. Superseded generations can never capture, close the order, or fund an old contractor.

Refunds are admin-only, idempotent, capped by remaining refundable funds, and use destination transfer reversal without application-fee refund semantics. Persist actual partial reversal results. Reconciliation imports actual balance-transaction fees and computes actual economics from the ledger. Disputes create operational alerts without rewriting service history.

## Security, implementation order, and verification

Use verified email OTP for customers, invitations for contractors/admins, and required TOTP MFA for admin commands. Apply CSRF/origin checks, secure cookies, redirect allowlists, trusted-boundary validation, database-backed HMAC-keyed rate limits, private proof storage, file size/type/magic-byte validation, short-lived authorized downloads, log/analytics redaction, immutable audit records, and retryable notification delivery.

Implementation order: scaffold and checks; database schemas/roles/RLS/routines/seed; identity and isolation; geography/pricing/quotes/booking; state machine/dispatch/concurrency; payment generations/authorization/reassignment/capture/refunds/reconciliation/webhooks; proofs/notifications/observability; customer/contractor/admin UI; documentation; verification and adversarial fixes.

Automated verification covers financial calculations, firm-quote supply and net-margin rules, payout funding, historical snapshots, RLS and cross-tenant denial, role attributes and grants, every privileged routine's allowed-via-routine/denied-direct invariant, atomic acceptance races, authorization timing, no-assignment deadlines, reassignment generations, old-contractor fund exclusion, destination PaymentIntent parameters, refund/reversal accounting, idempotent and out-of-order webhooks, proofs, admin audit, customer/contractor/admin flows, migrations, seeds, typecheck, lint, build, and Playwright E2E. Only checks that actually run successfully may be reported as passed.

Production activation remains gated on actual platform/connected-account countries and capabilities, destination-charge and `transfer_data[amount]` support, cross-region transfers, `on_behalf_of`, settlement merchant, statement descriptors, processing fees, refunds, disputes, negative balances, payout behavior, legal/tax/contractor policies, messaging consent, credentials, monitoring, backups, and recovery. Test-mode success is not proof of production Connect availability.
