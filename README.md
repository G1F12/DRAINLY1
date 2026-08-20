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
