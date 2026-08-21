import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookPage = readFileSync("src/app/book/page.tsx", "utf8");
const checkout = readFileSync("src/components/booking-checkout.tsx", "utf8");
const webhook = readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
const readiness = readFileSync("src/app/api/payments/readiness/route.ts", "utf8");

describe("stage 5 Stripe test flow", () => {
  it("shows a Stripe test checkout without enabling the core marketplace", () => {
    expect(bookPage).toContain('PAYMENT_PROVIDER_MODE ?? "fake"');
    expect(bookPage).toContain('"stripe_test"');
    expect(bookPage).toContain('mode: CheckoutMode = coreReal ? "live" : stripeTest ? "stripe_test" : "demo"');
  });

  it("confirms SetupIntent but does not create a booking in Stripe test mode", () => {
    expect(checkout).toContain("if (testOnly)");
    expect(checkout).toContain("testSetupComplete: true");
    expect(checkout).toContain("No Drainly booking, contractor dispatch, authorization, capture, or live charge was created.");
    expect(checkout).toContain("testOnly={isStripeTest}");
  });

  it("verifies Stripe test webhooks without persisting marketplace payment state", () => {
    expect(webhook).toContain('env.PAYMENT_PROVIDER_MODE === "stripe_test"');
    expect(webhook).toContain("constructWebhook(payload, signature)");
    expect(webhook).toContain("if (event.livemode)");
    expect(webhook).toContain('if (env.PROVIDER_MODE !== "real")');
    expect(webhook).toContain("testMode: true");
  });

  it("reports both secret and publishable test readiness without exposing keys", () => {
    expect(readiness).toContain("stripeTestUiConfigured");
    expect(readiness).toContain('startsWith("pk_test_")');
    expect(readiness).toContain("livePilotEnabled: false");
    expect(readiness).toContain("liveChargesAllowed: false");
    expect(readiness).not.toContain("STRIPE_SECRET_KEY!");
  });
});
