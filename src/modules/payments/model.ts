import type { CandidateEconomics } from "@/modules/pricing/money";

export interface AuthorizationScheduleInput {
  now: Date;
  serviceWindowStart: Date;
  authorizationLeadTimeMinutes: number;
  timingKind: "SCHEDULED" | "EARLIEST" | "URGENT";
  hasAssignment: boolean;
}

export interface AuthorizationSchedule {
  shouldCreatePaymentIntent: boolean;
  authorizeAt: Date | null;
  immediate: boolean;
}

export function scheduleAuthorization(input: AuthorizationScheduleInput): AuthorizationSchedule {
  if (!input.hasAssignment) return { shouldCreatePaymentIntent: false, authorizeAt: null, immediate: false };
  if (!Number.isSafeInteger(input.authorizationLeadTimeMinutes) || input.authorizationLeadTimeMinutes < 0) throw new Error("INVALID_AUTHORIZATION_LEAD_TIME");
  const target = new Date(input.serviceWindowStart.getTime() - input.authorizationLeadTimeMinutes * 60_000);
  const immediate = input.timingKind === "URGENT" || target <= input.now;
  return { shouldCreatePaymentIntent: true, authorizeAt: immediate ? input.now : target, immediate };
}

export interface DestinationAuthorizationInput {
  orderId: string;
  paymentGenerationId: string;
  connectedAccountId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  economics: CandidateEconomics;
}

export function destinationPaymentIntentParams(input: DestinationAuthorizationInput) {
  if (input.economics.contractorPayoutCents > input.economics.customerTotalCents) throw new Error("PAYOUT_NOT_FUNDED");
  return {
    amount: input.economics.customerTotalCents,
    currency: "usd" as const,
    customer: input.stripeCustomerId,
    payment_method: input.paymentMethodId,
    confirm: true,
    off_session: true,
    capture_method: "manual" as const,
    expand: ["latest_charge"],
    transfer_data: {
      destination: input.connectedAccountId,
      amount: input.economics.contractorPayoutCents,
    },
    metadata: { orderId: input.orderId, paymentGenerationId: input.paymentGenerationId },
  };
}

export function canCaptureGeneration(input: { isCurrent: boolean; assignmentActive: boolean; status: string }): boolean {
  return input.isCurrent && input.assignmentActive && ["AUTHORIZED", "CAPTURE_PENDING"].includes(input.status);
}
