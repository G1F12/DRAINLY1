import { describe, expect, it } from "vitest";

import { PaymentGenerationCoordinator, type GenerationPaymentPort, type PaymentGenerationSnapshot } from "@/modules/payments/generation-coordinator";
import type { CandidateEconomics } from "@/modules/pricing/money";

const economics: CandidateEconomics = {
  customerSubtotalCents: 36_500,
  customerFeeCents: 0,
  customerTotalCents: 36_500,
  contractorGrossCents: 32_500,
  contractorMarketplaceFeeCents: 3_250,
  contractorPayoutCents: 29_250,
  stripeTransferAmountCents: 29_250,
  platformGrossRetainedCents: 7_250,
  platformPricingAdjustmentCents: 4_000,
  estimatedPaymentProcessingCostCents: 1_125,
  expectedPlatformNetContributionCents: 6_125,
};

class ScriptedPort implements GenerationPaymentPort {
  readonly authorized: Array<{ generationId: string; destination: string }> = [];
  readonly cancelled: string[] = [];
  readonly captured: Array<{ paymentIntentId: string; contractorId: string }> = [];
  nextStatus: "AUTHORIZED" | "ACTION_REQUIRED" | "FAILED" = "AUTHORIZED";
  private generations = new Map<string, PaymentGenerationSnapshot>();

  async authorize(generation: PaymentGenerationSnapshot) {
    this.generations.set(`pi_${generation.id}`, generation);
    this.authorized.push({ generationId: generation.id, destination: generation.connectedAccountId });
    return { paymentIntentId: `pi_${generation.id}`, status: this.nextStatus };
  }
  async cancel(paymentIntentId: string) { this.cancelled.push(paymentIntentId); }
  async capture(paymentIntentId: string) {
    const generation = this.generations.get(paymentIntentId);
    if (!generation) throw new Error("UNKNOWN_INTENT");
    this.captured.push({ paymentIntentId, contractorId: generation.contractorId });
  }
}

const assignment = (contractorId: string, connectedAccountId: string) => ({
  contractorId,
  connectedAccountId,
  economics,
  now: new Date("2026-08-11T12:00:00Z"),
  serviceWindowStart: new Date("2026-08-12T12:00:00Z"),
  authorizationLeadTimeMinutes: 2880,
  timingKind: "SCHEDULED" as const,
});

describe("contractor-specific payment generations", () => {
  it("reassigns before authorization without creating or cancelling an old intent", async () => {
    const port = new ScriptedPort();
    const coordinator = new PaymentGenerationCoordinator(port);
    const old = coordinator.assign(assignment("old", "acct_old"));
    const replacement = await coordinator.reassign(assignment("replacement", "acct_replacement"));
    expect(old).toMatchObject({ status: "SUPERSEDED", isCurrent: false, assignmentActive: false });
    expect(replacement).toMatchObject({ number: 2, connectedAccountId: "acct_replacement", isCurrent: true });
    expect(port.cancelled).toEqual([]);
  });

  it("cancels an authorized old intent before creating the replacement generation", async () => {
    const port = new ScriptedPort();
    const coordinator = new PaymentGenerationCoordinator(port);
    const old = coordinator.assign(assignment("old", "acct_old"));
    await coordinator.authorizeCurrent();
    const replacement = await coordinator.reassign(assignment("replacement", "acct_replacement"));
    expect(port.cancelled).toEqual([`pi_${old.id}`]);
    expect(old).toMatchObject({ status: "SUPERSEDED", isCurrent: false, assignmentActive: false });
    expect(replacement.status).toBe("REQUESTED");
    expect(coordinator.audit.indexOf(`AUTHORIZATION_CANCELLED:${old.id}`)).toBeLessThan(coordinator.audit.indexOf(`ASSIGNED:${replacement.id}:replacement`));
  });

  it.each(["ACTION_REQUIRED", "FAILED"] as const)("keeps service and capture blocked when replacement authorization is %s", async (status) => {
    const port = new ScriptedPort();
    const coordinator = new PaymentGenerationCoordinator(port);
    coordinator.assign(assignment("old", "acct_old"));
    await coordinator.authorizeCurrent();
    await coordinator.reassign(assignment("replacement", "acct_replacement"));
    port.nextStatus = status;
    const replacement = await coordinator.authorizeCurrent();
    expect(replacement.status).toBe(status);
    await expect(coordinator.captureCurrent()).rejects.toThrow("GENERATION_NOT_CAPTURABLE");
  });

  it("authorizes and captures only to the replacement destination", async () => {
    const port = new ScriptedPort();
    const coordinator = new PaymentGenerationCoordinator(port);
    coordinator.assign(assignment("old", "acct_old"));
    await coordinator.authorizeCurrent();
    const replacement = await coordinator.reassign(assignment("replacement", "acct_replacement"));
    await coordinator.authorizeCurrent();
    await coordinator.captureCurrent();
    expect(port.authorized).toEqual([
      { generationId: "generation-1", destination: "acct_old" },
      { generationId: "generation-2", destination: "acct_replacement" },
    ]);
    expect(port.captured).toEqual([{ paymentIntentId: `pi_${replacement.id}`, contractorId: "replacement" }]);
    expect(port.captured.some((capture) => capture.contractorId === "old")).toBe(false);
  });

  it("refuses automated reassignment after capture", async () => {
    const port = new ScriptedPort();
    const coordinator = new PaymentGenerationCoordinator(port);
    coordinator.assign(assignment("old", "acct_old"));
    await coordinator.authorizeCurrent();
    await coordinator.captureCurrent();
    await expect(coordinator.reassign(assignment("replacement", "acct_replacement"))).rejects.toThrow("CAPTURED_PAYMENT_REQUIRES_MANUAL_RECOVERY");
  });
});
