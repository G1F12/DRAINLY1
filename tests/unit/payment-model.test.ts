import { describe, expect, it } from "vitest";
import { canCaptureGeneration, destinationPaymentIntentParams, scheduleAuthorization } from "@/modules/payments/model";
import type { CandidateEconomics } from "@/modules/pricing/money";

const economics: CandidateEconomics = { customerSubtotalCents: 36_500, customerFeeCents: 0, customerTotalCents: 36_500, contractorGrossCents: 32_500, contractorMarketplaceFeeCents: 3_250, contractorPayoutCents: 29_250, stripeTransferAmountCents: 29_250, platformGrossRetainedCents: 7_250, platformPricingAdjustmentCents: 4_000, estimatedPaymentProcessingCostCents: 1_125, expectedPlatformNetContributionCents: 6_125 };
describe("payment generations", () => {
  it("schedules an early assignment at the configurable lead time", () => { const result = scheduleAuthorization({ now: new Date("2026-08-10T12:00:00Z"), serviceWindowStart: new Date("2026-08-15T12:00:00Z"), authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: true }); expect(result.immediate).toBe(false); expect(result.authorizeAt?.toISOString()).toBe("2026-08-13T12:00:00.000Z"); });
  it("authorizes immediately inside the window and for urgent work", () => { const now = new Date("2026-08-14T12:00:00Z"); expect(scheduleAuthorization({ now, serviceWindowStart: new Date("2026-08-15T12:00:00Z"), authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: true }).immediate).toBe(true); expect(scheduleAuthorization({ now, serviceWindowStart: new Date("2026-08-20T12:00:00Z"), authorizationLeadTimeMinutes: 2880, timingKind: "URGENT", hasAssignment: true }).immediate).toBe(true); });
  it("creates no contractor-specific PaymentIntent without assignment", () => { expect(scheduleAuthorization({ now: new Date(), serviceWindowStart: new Date(), authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: false })).toEqual({ shouldCreatePaymentIntent: false, authorizeAt: null, immediate: false }); });
  it("authorizes a later assignment immediately after an empty deadline", () => {
    const service = new Date("2026-08-15T12:00:00Z");
    expect(scheduleAuthorization({ now: new Date("2026-08-13T12:00:00Z"), serviceWindowStart: service, authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: false }).shouldCreatePaymentIntent).toBe(false);
    const assignedLater = scheduleAuthorization({ now: new Date("2026-08-14T18:00:00Z"), serviceWindowStart: service, authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: true });
    expect(assignedLater.immediate).toBe(true);
    expect(assignedLater.authorizeAt?.toISOString()).toBe("2026-08-14T18:00:00.000Z");
  });
  it("attempts authorization immediately for a last-minute scheduled assignment", () => {
    const now = new Date("2026-08-15T11:55:00Z");
    expect(scheduleAuthorization({ now, serviceWindowStart: new Date("2026-08-15T12:00:00Z"), authorizationLeadTimeMinutes: 2880, timingKind: "SCHEDULED", hasAssignment: true })).toEqual({ shouldCreatePaymentIntent: true, authorizeAt: now, immediate: true });
  });
  it("uses transfer_data amount, expands capture metadata, and never application_fee_amount", () => { const params = destinationPaymentIntentParams({ orderId: "o", paymentGenerationId: "g", connectedAccountId: "acct_test", stripeCustomerId: "cus_test", paymentMethodId: "pm_test", economics }); expect(params.amount).toBe(36_500); expect(params.transfer_data).toEqual({ destination: "acct_test", amount: 29_250 }); expect(params).not.toHaveProperty("application_fee_amount"); expect(params.capture_method).toBe("manual"); expect(params.expand).toEqual(["latest_charge"]); });
  it("never creates an underfunded destination transfer", () => { expect(() => destinationPaymentIntentParams({ orderId: "o", paymentGenerationId: "g", connectedAccountId: "acct", stripeCustomerId: "cus", paymentMethodId: "pm", economics: { ...economics, contractorPayoutCents: 36_501 } })).toThrow("PAYOUT_NOT_FUNDED"); });
  it("captures only the current active generation", () => { expect(canCaptureGeneration({ isCurrent: true, assignmentActive: true, status: "AUTHORIZED" })).toBe(true); expect(canCaptureGeneration({ isCurrent: false, assignmentActive: true, status: "AUTHORIZED" })).toBe(false); expect(canCaptureGeneration({ isCurrent: true, assignmentActive: false, status: "AUTHORIZED" })).toBe(false); });
});
