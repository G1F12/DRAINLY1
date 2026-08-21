import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const systemDb = readFileSync("src/lib/system-db.ts", "utf8");
const rateLimit = readFileSync("src/lib/rate-limit.ts", "utf8");
const connectServer = readFileSync("src/modules/payments/contractor-connect-server.ts", "utf8");
const worker = readFileSync("src/app/api/internal/jobs/tick/route.ts", "utf8");
const readiness = readFileSync("src/app/api/pilot/readiness/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260821132917_stage5_final_marketplace_payment_closure.sql", "utf8");

describe("Stage 5 final engineering closure", () => {
  it("gives Stripe test/Connect trusted DB access without enabling core marketplace", () => {
    expect(systemDb).toContain("export function getPaymentSystemDb()");
    expect(connectServer).toContain("getPaymentSystemDb()");
    expect(connectServer).not.toContain("getSystemDb()");
    expect(env).toContain('"DRAINLY_SYSTEM_DATABASE_URL"');
    expect(env).toContain('"RATE_LIMIT_HMAC_SECRET"');
  });
  it("uses persistent payment rate limits", () => {
    expect(rateLimit).toContain("consumePaymentRateLimit");
    expect(rateLimit).toContain("getPaymentSystemDb()");
  });
  it("rechecks recipient transfer readiness before authorize/capture", () => {
    expect(worker).toContain("contractorConnectReady?: boolean");
    expect(worker).toContain('throw new Error("CONTRACTOR_CONNECT_NOT_READY")');
    expect(migration).toContain("internal.contractor_test_payment_ready");
    expect(migration).toContain("internal.assert_pilot_payment_execution");
    expect(migration).toContain("'contractorConnectReady'");
  });
  it("has independent database booking/payment kill switches", () => {
    expect(migration).toContain("PILOT_BOOKING_EXECUTION_DISABLED");
    expect(migration).toContain("PILOT_PAYMENT_EXECUTION_DISABLED");
    expect(migration).toContain("PILOT_CUSTOMER_TOTAL_LIMIT_EXCEEDED");
    expect(migration).toContain("admin_set_pilot_controls");
  });
  it("keeps live money impossible in this phase", () => {
    expect(env).toContain('PAYMENT_PROVIDER_MODE: z.enum(["fake", "stripe_test"])');
    expect(readiness).toContain("liveChargesAllowed: false");
  });
});
