import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const pilotGate = readFileSync("src/lib/pilot-gate.ts", "utf8");
const bookings = readFileSync("src/app/api/bookings/route.ts", "utf8");
const worker = readFileSync("src/app/api/internal/jobs/tick/route.ts", "utf8");
const readiness = readFileSync("src/app/api/pilot/readiness/route.ts", "utf8");
const envExample = readFileSync(".env.example", "utf8");

describe("stage 5 controlled sandbox pilot gate", () => {
  it("defaults the transactional pilot to closed", () => {
    expect(env).toContain('PILOT_MODE: z.enum(["off", "sandbox"]).default("off")');
    expect(envExample).toContain("PILOT_MODE=off");
    expect(pilotGate).toContain('if (env.PILOT_MODE !== "sandbox")');
    expect(pilotGate).toContain('"PILOT_MODE_OFF"');
  });

  it("requires real core/auth, Stripe test payments, and an explicit customer allowlist", () => {
    expect(pilotGate).toContain('env.PROVIDER_MODE !== "real"');
    expect(pilotGate).toContain('env.AUTH_PROVIDER_MODE !== "real"');
    expect(pilotGate).toContain('env.PAYMENT_PROVIDER_MODE !== "stripe_test"');
    expect(pilotGate).toContain("allowlist.size === 0");
    expect(pilotGate).toContain("allowlist.has(normalizedEmail)");
    expect(pilotGate).toContain("liveChargesAllowed: false");
  });

  it("blocks real booking creation before trusted setup-intent verification when pilot access is closed", () => {
    const gateIndex = bookings.indexOf("getSandboxPilotGate(user.email)");
    const verifyIndex = bookings.indexOf("verifySetupIntent(body.setupIntentId)");
    const createBookingIndex = bookings.indexOf('client.rpc("create_booking"');

    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(verifyIndex);
    expect(gateIndex).toBeLessThan(createBookingIndex);
    expect(bookings).toContain("This account is not allowlisted for the controlled sandbox pilot");
  });

  it("blocks authorize and capture before begin_authorization while preserving unwind operations", () => {
    const authorizeGuard = worker.indexOf('assertSandboxPilotMoneyMovementAllowed("AUTHORIZE")');
    const captureGuard = worker.indexOf('assertSandboxPilotMoneyMovementAllowed("CAPTURE")');
    const beginAuthorization = worker.indexOf("internal.begin_authorization");

    expect(authorizeGuard).toBeGreaterThan(-1);
    expect(captureGuard).toBeGreaterThan(-1);
    expect(authorizeGuard).toBeLessThan(beginAuthorization);
    expect(worker).toContain("cancelAuthorization(");
    expect(worker).toContain(".refund({");
  });

  it("exposes only non-secret pilot readiness and never enables live charges", () => {
    expect(readiness).toContain("allowlistConfigured");
    expect(readiness).toContain("callerAllowlisted");
    expect(readiness).toContain("liveChargesAllowed: false");
    expect(readiness).not.toContain("PILOT_ALLOWED_EMAILS");
    expect(readiness).not.toContain("STRIPE_SECRET_KEY");
  });
});
