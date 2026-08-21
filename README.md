# Drainly US pilot MVP

Production-oriented pilot implementation for septic pumping coordination in Johnston and Harnett Counties, North Carolina. The repository is a strict-TypeScript Next.js modular monolith backed by PostgreSQL/Supabase and Stripe Connect test-mode adapters.

The locked implementation plan is [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Architecture and operational details live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PILOT_OPERATIONS.md](docs/PILOT_OPERATIONS.md).

## Safety boundary

- `PROVIDER_MODE=fake` is the default core mode. In this mode the application does not create Supabase server clients, privileged PostgreSQL connections, Google geocoding requests, or Stripe provider calls; demo flows are deterministic and non-persistent.
- `NOTIFICATION_PROVIDER_MODE=fake` is independently defaulted to fake. Real Resend delivery can be enabled without enabling payments, marketplace writes, or geocoding. Resend delivery events are signature-verified and persisted separately from core marketplace state.
- The real Stripe adapter rejects non-test secret keys.
- This repository must not be used for an uncontrolled live marketplace until every gate in [docs/PRODUCTION_GATES.md](docs/PRODUCTION_GATES.md) is signed off.
- Worker and webhook SQL uses `DRAINLY_SYSTEM_DATABASE_URL`, a dedicated `drainly_system` login. A Supabase service-role JWT is not a substitute.

## Local setup

Requirements: Node.js 22+, pnpm 10+, Docker Desktop, and Supabase CLI.

```powershell
Copy-Item .env.example .env.local
pnpm install --frozen-lockfile
supabase start
supabase db reset
pnpm db:types
pnpm dev
```

The default `.env.example` keeps both core providers and notifications in fake mode. The Supabase seed contains fictional `.example.test` users and test-mode provider identifiers only.

## Verification

The commands are intentionally split so database checks cannot be reported as a skipped pass:

- `pnpm test` / `pnpm test:unit`: unit and static source tests only; no database is required.
- `pnpm test:integration`: real PostgreSQL integration and concurrency tests. `TEST_DATABASE_URL` is mandatory and must be reachable; otherwise the command exits nonzero.
- `pnpm test:db`: Supabase-native SQL suites against the local Supabase database.
- `pnpm verify`: lightweight non-database verification (typecheck, lint, unit/static tests, build, secret scan).
- `pnpm verify:full`: all application checks plus Supabase SQL, generated-type drift, database integration/concurrency, and Playwright. It requires a running local Supabase stack and `TEST_DATABASE_URL`.

```powershell
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:db
$env:TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'; pnpm test:integration
pnpm test:e2e
pnpm build
pnpm scan:secrets
```

The CI database job invokes `pnpm test:integration` with its local Supabase PostgreSQL URL. A missing or unavailable database is a failure, never a skipped pass.

## Provider modes

The app has two independent switches:

- `PROVIDER_MODE=fake|real` controls core marketplace providers and privileged persistence: Supabase server access, PostgreSQL system access, Stripe, Google geocoding, contractor writes, booking persistence, proof storage, and Stripe webhook processing.
- `NOTIFICATION_PROVIDER_MODE=fake|real` controls outbound notification adapters. Real notification mode requires the notification database path, `CRON_SECRET`, `RATE_LIMIT_HMAC_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and a verified `EMAIL_FROM`; Twilio remains optional until SMS is actually enabled.

This separation allows Drainly to test real email delivery while the marketplace, payments, and contractor operations remain safely in demo mode. Successful real business mutations schedule a post-response notification drain. A daily Vercel Cron calls `/api/internal/notifications/tick` as a retry/backstop and also processes due service reminders. Resend webhook events (`sent`, `delivered`, `delayed`, `bounced`, `complained`, `failed`, `suppressed`) are verified before persistence and linked to the provider message ID.

PostHog and Sentry are server/client-configuration ready, with PII-safe logging at application boundaries. Core real mode requires explicit environment validation and remains Stripe test-mode only.

## Data access

PostgREST exposes only `api`. `domain` and `internal` are private schemas. Authenticated clients can read security-invoker API views and invoke allowlisted commands; all protected writes occur through hardened `SECURITY DEFINER` routines. Database tests verify the routine succeeds and the same caller cannot mutate the underlying table directly.

## Stage 3 contractor supply boundary

Authenticated contractor onboarding is intentionally separate from the core marketplace provider switch. With real Supabase auth enabled, a signed-in contractor may create or update a real contractor company profile, service areas, weekly capacity, contractor-set tank-size pricing, and self-submitted verification references through auth-scoped RPCs while `PROVIDER_MODE=fake` continues to block live booking, dispatch, geocoding, and Stripe paths.

New contractor companies remain `PENDING`. Self-submitted license/permit and insurance references remain `SUBMITTED`, not verified. This stage does not create Stripe connected accounts, enable payouts, approve contractors, or make them eligible for live dispatch.

## Stage 4 marketplace matching boundary

Stage 4 adds a real, read-only marketplace matching engine on top of the Stage 3 contractor registry while core booking/payment providers remain isolated. Candidate eligibility uses approved company status, service-area coverage, weekday availability, blackout dates, remaining daily capacity, an active contractor price book, and the requested tank/timing price.

The customer-facing preview price is contractor-set: the lowest ranked eligible contractor price is the displayed subtotal/total for this preview boundary. Ranking is deterministic: contractor price first, then current-day utilization, then contractor priority, then stable ID. Planned and earliest jobs use one contractor confirmation target; urgent jobs prepare a broadcast wave of up to three candidates.

Stripe readiness is reported separately and is not used to hide otherwise matchable supply at this stage. Stage 4 does not create orders, offers, assignments, payment generations, or Stripe activity. The existing live booking path remains behind `PROVIDER_MODE=real` and is intentionally not switched to this preview engine until the controlled payment/pilot stage.

Authenticated header UX now replaces `Sign in` with `Dashboard` plus `Log out`. Pending contractor accounts route back to contractor onboarding; approved contractors route to the contractor dashboard; other signed-in users route to the customer dashboard.

## Stage 5 payment readiness boundary

Payments are now independently switchable with `PAYMENT_PROVIDER_MODE`. The only real adapter accepted by the application is `stripe_test`; live Stripe secret keys remain rejected by both environment validation and the Stripe gateway constructor.

This stage does not turn the core marketplace real and does not enable live charges. `PROVIDER_MODE=fake` may remain in place while authenticated test users exercise Stripe test SetupIntent flows. `/api/payments/readiness` exposes only non-secret readiness flags and always reports `livePilotEnabled=false` and `liveChargesAllowed=false` until a later explicit pilot gate is implemented and approved.

A Stripe test SetupIntent requires a verified signed-in Drainly user. Booking creation is still gated by the existing core provider path, so enabling the test payment adapter alone cannot create production orders or activate live dispatch.
## Stage 5 Stripe test flow

With `PAYMENT_PROVIDER_MODE=stripe_test` and `PROVIDER_MODE=fake`, authenticated users can exercise a real Stripe test-mode SetupIntent and Payment Element without creating a Drainly order. The checkout explicitly labels the flow as test-only and stops after reusable test payment-method setup.

The Stripe webhook endpoint also becomes active for test mode: it verifies the real Stripe signature and rejects any `livemode=true` event. While the core marketplace remains fake, verified test events are acknowledged but are not persisted into order/payment state.

This boundary is intentionally non-transactional: no order, offer, assignment, PaymentIntent authorization, capture, refund, payout, or live charge is created. Moving beyond this boundary requires a separate explicit controlled-pilot gate.
## Stage 5 controlled sandbox pilot gate

Transactional marketplace behavior now has a second explicit safety switch in addition to `PROVIDER_MODE`. `PILOT_MODE` defaults to `off`. A sandbox pilot booking can be created only when all of the following are true: core provider mode is real, Supabase auth is real, the Stripe adapter is `stripe_test`, `PILOT_MODE=sandbox`, and the verified customer email appears in `PILOT_ALLOWED_EMAILS`.

The payment worker independently enforces the same infrastructure gate before AUTHORIZE and CAPTURE operations and does so before `internal.begin_authorization` can mutate payment-generation state. Cancellation and refund operations remain available so an operator can unwind an already-created sandbox authorization even after the pilot gate is closed.

`/api/pilot/readiness` exposes only non-secret readiness flags. It never returns the allowlist itself or Stripe credentials and always reports `liveChargesAllowed=false`.

This is a sandbox-only control boundary. The current Stripe gateway still rejects live secret keys. Turning on live money movement requires a separate future implementation and review; changing `PILOT_MODE` alone cannot enable live Stripe charges.
## Stage 5E Stripe Connect sandbox onboarding

Contractor payout onboarding uses Stripe Connect in sandbox/test mode only. Drainly creates recipient-only connected accounts through the Accounts v2 API with Express Dashboard access, platform-owned fees/loss responsibility, and only the `stripe_balance.stripe_transfers` capability requested. Direct card-payment capabilities are intentionally not requested for contractors because customer charges belong to the marketplace payment flow.

The contractor is sent to a single-use Stripe-hosted Account Link for the `recipient` configuration. Stripe collects identity, verification, and bank information; Drainly stores only the connected account ID and a safe transfer-capability status. Account binding and status persistence are available only through `drainly_system` routines and require an active OWNER membership for the authenticated contractor company.

A connected contractor is marked sandbox-ready only when Stripe reports the recipient transfer capability as `active`. This does not yet change legacy contractor approval/payment eligibility and it never enables live payouts. The transactional pilot gate remains closed independently until a later stage explicitly reconciles recipient readiness with order eligibility and opens a named sandbox pilot.
## Stage 5 engineering closure

Stage 5 is engineering-complete in a deliberately closed sandbox state. Stripe test SetupIntent/Payment Element, verified test webhooks, recipient-only Connect onboarding, fixed customer-price versus contractor-payout economics, destination authorization with manual capture, reassignment generations, refund/reversal handling, and authoritative payment readiness are implemented.

Connect/payment persistence uses a payment-scoped trusted PostgreSQL path even while the core marketplace remains in fake mode. Runtime contractor payment eligibility uses recipient `stripe_transfers` capability rather than legacy connected-account charge/payout flags. Booking, offer acceptance, reassignment, authorization, and capture are protected by independent application and database pilot gates. Cancellation/refund remain available for safe unwind.

Database pilot controls remain disabled by default. The application rejects live Stripe secret keys and reports `liveChargesAllowed=false`. Real contractors, verified credentials, service regions, regional pricing, marketplace settings, platform Stripe capabilities, legal/operational review, and explicit pilot activation remain separate go-live prerequisites.
## Stage 5.1 real contractor dashboard

Authenticated contractor reads are independent from the core marketplace provider switch. With real Supabase auth enabled, `/contractor` reads only the authenticated company's real contractor context, offers, and assignments. A user without a contractor profile is redirected to onboarding; a pending contractor sees a real review state with no simulated offers or jobs.

Operational contractor views are explicitly scoped by authenticated contractor-company membership and remain `security_invoker` views. The underlying offer, assignment, and order RLS predicates are also tenant-scoped as defense in depth. Real-auth users never receive fake successful contractor mutations while the core pilot is closed. Accept/decline/job/proof controls are hidden until both application and database controlled-pilot execution gates are open.