# Drainly US pilot MVP

Production-oriented pilot implementation for septic pumping coordination in Johnston and Harnett Counties, North Carolina. The repository is a strict-TypeScript Next.js modular monolith backed by PostgreSQL/Supabase and Stripe Connect test-mode adapters.

The locked implementation plan is [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Architecture and operational details live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PILOT_OPERATIONS.md](docs/PILOT_OPERATIONS.md).

## Safety boundary

- `PROVIDER_MODE=fake` is the default. Fake payment and notification adapters are deterministic and make no network calls.
- The real Stripe adapter rejects non-test secret keys.
- This repository contains no deployment automation and must not be used for production until every gate in [docs/PRODUCTION_GATES.md](docs/PRODUCTION_GATES.md) is signed off.
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

The checked-in `.env.test` selects fake providers. The Supabase seed contains fictional `.example.test` users and test-mode provider identifiers only.

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

The app ships interface-compatible real and fake/test adapters for Stripe, Google Maps, Twilio, Resend, and Supabase Storage. PostHog and Sentry are server/client-configuration ready, with PII-safe logging at application boundaries. Real mode requires explicit environment validation and remains Stripe test-mode only.

## Data access

PostgREST exposes only `api`. `domain` and `internal` are private schemas. Authenticated clients can read security-invoker API views and invoke allowlisted commands; all protected writes occur through hardened `SECURITY DEFINER` routines. Database tests verify the routine succeeds and the same caller cannot mutate the underlying table directly.
