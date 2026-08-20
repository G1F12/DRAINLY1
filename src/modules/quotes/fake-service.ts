import { addMinutes, formatISO } from "date-fns";

import type { NormalizedAddress } from "@/modules/geography/geocoder";
import { calculateCandidateEconomics, candidateMeetsFirmQuoteGuardrail } from "@/modules/pricing/money";

const baseByTank = { GAL_750: 32_500, GAL_1000: 36_500, GAL_1250: 40_500, GAL_1500: 44_500 } as const;

export function createFakeQuote(input: {
  normalizedAddress: NormalizedAddress;
  tankTier: keyof typeof baseByTank | "UNKNOWN";
  timingKind: "SCHEDULED" | "EARLIEST" | "URGENT";
}) {
  const quoteId = crypto.randomUUID();
  if (!input.normalizedAddress.regionKey) return { quoteId, status: "UNSUPPORTED" as const };
  if (input.tankTier === "UNKNOWN") return { quoteId, status: "REVIEW_REQUIRED" as const };
  const surcharge = input.timingKind === "URGENT" ? 10_000 : input.timingKind === "EARLIEST" ? 1_500 : 0;
  const subtotal = baseByTank[input.tankTier] + surcharge;
  const gross = subtotal - 3_500;
  const economics = calculateCandidateEconomics({ customerSubtotalCents: subtotal, customerFeeCents: 0, contractorGrossCents: gross, contractorFeeBps: 1_000, contractorFixedFeeCents: 0, processing: { rateBps: 300, fixedCents: 30 } });
  if (!candidateMeetsFirmQuoteGuardrail(economics, 1_000)) return { quoteId, status: "REVIEW_REQUIRED" as const };
  return { quoteId, status: "PRICED" as const, expiresAt: formatISO(addMinutes(new Date(), 30)), ...economics, eligibleCandidateCount: 2, viableCandidateCount: 2 };
}
