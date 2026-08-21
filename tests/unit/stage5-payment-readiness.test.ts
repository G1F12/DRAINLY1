import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const gateway = readFileSync("src/modules/payments/gateway.ts", "utf8");
const setupIntent = readFileSync("src/app/api/payments/setup-intent/route.ts", "utf8");
const readiness = readFileSync("src/app/api/payments/readiness/route.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

describe("stage 5 payment readiness boundary", () => {
  it("decouples Stripe test mode from the core marketplace provider", () => {
    expect(env).toContain('PAYMENT_PROVIDER_MODE: z.enum(["fake", "stripe_test"])');
    expect(gateway).toContain('env.PAYMENT_PROVIDER_MODE === "stripe_test"');
    expect(envExample).toContain("PAYMENT_PROVIDER_MODE=fake");
  });

  it("rejects live Stripe secret keys", () => {
    expect(env).toContain('startsWith("sk_test_")');
    expect(gateway).toContain('if (!secretKey.startsWith("sk_test_"))');
  });

  it("requires real auth before creating Stripe setup intents", () => {
    expect(setupIntent).toContain('process.env.PAYMENT_PROVIDER_MODE === "stripe_test"');
    expect(setupIntent).toContain("Verified customer sign-in is required");
  });

  it("keeps live pilot and live charges disabled", () => {
    expect(readiness).toContain("livePilotEnabled: false");
    expect(readiness).toContain("liveChargesAllowed: false");
    expect(readiness).not.toContain("sk_test_");
    expect(readiness).not.toContain("STRIPE_SECRET_KEY!");
  });
});
