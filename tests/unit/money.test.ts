import { describe, expect, it } from "vitest";
import { actualPlatformNetTransactionCents, calculateCandidateEconomics, candidateMeetsFirmQuoteGuardrail, estimateProcessingCostCents, percentageCentsHalfUp } from "@/modules/pricing/money";

describe("money and quote economics", () => {
  it("calculates every persisted financial term in integer cents", () => {
    const result = calculateCandidateEconomics({ customerSubtotalCents: 36_500, customerFeeCents: 0, contractorGrossCents: 32_500, contractorFeeBps: 1_000, contractorFixedFeeCents: 0, processing: { rateBps: 300, fixedCents: 30 } });
    expect(result).toEqual({ customerSubtotalCents: 36_500, customerFeeCents: 0, customerTotalCents: 36_500, contractorGrossCents: 32_500, contractorMarketplaceFeeCents: 3_250, contractorPayoutCents: 29_250, stripeTransferAmountCents: 29_250, platformGrossRetainedCents: 7_250, platformPricingAdjustmentCents: 4_000, estimatedPaymentProcessingCostCents: 1_125, expectedPlatformNetContributionCents: 6_125 });
  });
  it("uses a conservative ceiling for estimated processing cost", () => { expect(estimateProcessingCostCents(101, { rateBps: 299, fixedCents: 30 })).toBe(34); });
  it("rounds percentage marketplace fees half up", () => { expect(percentageCentsHalfUp(101, 500)).toBe(5); expect(percentageCentsHalfUp(110, 500)).toBe(6); });
  it("requires funded payout and net contribution", () => {
    const viable = calculateCandidateEconomics({ customerSubtotalCents: 40_000, customerFeeCents: 0, contractorGrossCents: 35_000, contractorFeeBps: 0, contractorFixedFeeCents: 0, processing: { rateBps: 300, fixedCents: 30 } });
    expect(candidateMeetsFirmQuoteGuardrail(viable, 3_000)).toBe(true);
    expect(candidateMeetsFirmQuoteGuardrail(viable, 4_000)).toBe(false);
    expect(candidateMeetsFirmQuoteGuardrail({ ...viable, contractorPayoutCents: 40_001 }, -100_000)).toBe(false);
  });
  it("rejects floating and invalid financial configuration", () => {
    expect(() => calculateCandidateEconomics({ customerSubtotalCents: 1.5, customerFeeCents: 0, contractorGrossCents: 1, contractorFeeBps: 0, contractorFixedFeeCents: 0, processing: { rateBps: 0, fixedCents: 0 } })).toThrow();
    expect(() => estimateProcessingCostCents(100, { rateBps: 10_001, fixedCents: 0 })).toThrow();
  });
  it("reconciles actual provider economics independently of quote-time estimates", () => {
    expect(actualPlatformNetTransactionCents([
      { type: "CAPTURE", amountCents: 36_500 },
      { type: "CONTRACTOR_TRANSFER", amountCents: 29_250 },
      { type: "STRIPE_PROCESSING_FEE", amountCents: 1_120 },
      { type: "CUSTOMER_REFUND", amountCents: 10_000 },
      { type: "TRANSFER_REVERSAL", amountCents: 8_000 },
      { type: "DISPUTE_FEE", amountCents: 1_500 },
    ])).toBe(2_630);
  });
  it("rejects invalid ledger amounts", () => {
    expect(() => actualPlatformNetTransactionCents([{ type: "CAPTURE", amountCents: -1 }])).toThrow("INVALID_LEDGER_AMOUNT");
  });
});
