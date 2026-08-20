import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync("src/app/api/internal/jobs/tick/route.ts", "utf8");
const gateway = readFileSync("src/modules/notifications/gateway.ts", "utf8");
const notificationOutbox = readFileSync("src/modules/notifications/outbox.ts", "utf8");
const fakeOrder = readFileSync("src/app/api/orders/[id]/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/202608110004_final_audit_hardening.sql", "utf8");

describe("worker hardening source invariants", () => {
  it("preserves logical payment-provider idempotency across fresh retry tasks", () => {
    expect(worker).toContain("`authorize:${context.paymentGenerationId}`");
    expect(worker).toContain("`capture:${context.paymentGenerationId}`");
    expect(worker).toContain("`cancel:${context.paymentGenerationId}`");
    expect(migration).toContain("'admin-payment-retry:' || p_idempotency_key");
  });

  it("applies the centralized timeout to Resend and Twilio adapters", () => {
    expect(notificationOutbox).toContain("withOutboundProviderTimeout");
    expect(gateway).toContain("signal,");
    expect(gateway).toContain("{ timeout: timeoutMs, autoRetry: false }");
    expect(gateway).toContain('"idempotency-key": message.idempotencyKey');
    expect(gateway).toContain("timeout: timeoutMs");
  });

  it("does not fabricate a confirmed appointment in the fake order endpoint", () => {
    expect(fakeOrder).toContain('status: "SEARCHING_CONTRACTOR"');
    expect(fakeOrder).not.toContain('status: "SCHEDULED"');
  });
});
