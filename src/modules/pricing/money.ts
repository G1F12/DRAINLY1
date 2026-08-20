export interface ProcessingEstimate {
  rateBps: number;
  fixedCents: number;
}

export interface CandidateEconomicsInput {
  customerSubtotalCents: number;
  customerFeeCents: number;
  contractorGrossCents: number;
  contractorFeeBps: number;
  contractorFixedFeeCents: number;
  processing: ProcessingEstimate;
}

export interface CandidateEconomics {
  customerSubtotalCents: number;
  customerFeeCents: number;
  customerTotalCents: number;
  contractorGrossCents: number;
  contractorMarketplaceFeeCents: number;
  contractorPayoutCents: number;
  stripeTransferAmountCents: number;
  platformGrossRetainedCents: number;
  platformPricingAdjustmentCents: number;
  estimatedPaymentProcessingCostCents: number;
  expectedPlatformNetContributionCents: number;
}

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

export function percentageCentsHalfUp(amountCents: number, rateBps: number): number {
  assertCents(amountCents, "amountCents");
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error("rateBps must be between 0 and 10000");
  return Math.floor((amountCents * rateBps + 5_000) / 10_000);
}

export function estimateProcessingCostCents(totalCents: number, estimate: ProcessingEstimate): number {
  assertCents(totalCents, "totalCents");
  assertCents(estimate.fixedCents, "fixedCents");
  if (!Number.isSafeInteger(estimate.rateBps) || estimate.rateBps < 0 || estimate.rateBps > 10_000) throw new Error("rateBps must be between 0 and 10000");
  return Math.ceil((totalCents * estimate.rateBps) / 10_000) + estimate.fixedCents;
}

export function calculateCandidateEconomics(input: CandidateEconomicsInput): CandidateEconomics {
  Object.entries(input).forEach(([key, value]) => {
    if (key !== "processing") assertCents(value as number, key);
  });
  const customerTotalCents = input.customerSubtotalCents + input.customerFeeCents;
  const fee = Math.min(
    input.contractorGrossCents,
    percentageCentsHalfUp(input.contractorGrossCents, input.contractorFeeBps) + input.contractorFixedFeeCents,
  );
  const payout = input.contractorGrossCents - fee;
  const estimatedPaymentProcessingCostCents = estimateProcessingCostCents(customerTotalCents, input.processing);
  return {
    customerSubtotalCents: input.customerSubtotalCents,
    customerFeeCents: input.customerFeeCents,
    customerTotalCents,
    contractorGrossCents: input.contractorGrossCents,
    contractorMarketplaceFeeCents: fee,
    contractorPayoutCents: payout,
    stripeTransferAmountCents: payout,
    platformGrossRetainedCents: customerTotalCents - payout,
    platformPricingAdjustmentCents: input.customerSubtotalCents - input.contractorGrossCents,
    estimatedPaymentProcessingCostCents,
    expectedPlatformNetContributionCents: customerTotalCents - payout - estimatedPaymentProcessingCostCents,
  };
}

export function candidateMeetsFirmQuoteGuardrail(economics: CandidateEconomics, minimumContributionMarginCents: number): boolean {
  if (!Number.isSafeInteger(minimumContributionMarginCents)) throw new Error("minimumContributionMarginCents must be an integer");
  return economics.contractorPayoutCents <= economics.customerTotalCents
    && economics.expectedPlatformNetContributionCents >= minimumContributionMarginCents;
}

export type LedgerEntryType =
  | "CAPTURE"
  | "CUSTOMER_REFUND"
  | "CONTRACTOR_TRANSFER"
  | "TRANSFER_REVERSAL"
  | "STRIPE_PROCESSING_FEE"
  | "DISPUTE_FEE"
  | "OTHER_PROVIDER_FEE";

export interface LedgerEntry {
  type: LedgerEntryType;
  amountCents: number;
}

/** Reconciled provider economics; deliberately independent of quote estimates. */
export function actualPlatformNetTransactionCents(entries: LedgerEntry[]): number {
  return entries.reduce((net, entry) => {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents < 0) throw new Error("INVALID_LEDGER_AMOUNT");
    switch (entry.type) {
      case "CAPTURE":
      case "TRANSFER_REVERSAL":
        return net + entry.amountCents;
      case "CUSTOMER_REFUND":
      case "CONTRACTOR_TRANSFER":
      case "STRIPE_PROCESSING_FEE":
      case "DISPUTE_FEE":
      case "OTHER_PROVIDER_FEE":
        return net - entry.amountCents;
    }
  }, 0);
}

export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("cents must be an integer");
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
