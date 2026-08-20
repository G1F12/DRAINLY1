export type OrderStatus =
  | "SEARCHING_CONTRACTOR" | "SCHEDULED" | "EN_ROUTE" | "ARRIVED" | "SERVICE_COMPLETED" | "CLOSED"
  | "CANCELLED" | "FAILED_ACCESS" | "FAILED_SERVICE" | "REASSIGNMENT_PENDING" | "NEEDS_ADMIN_REVIEW";

export type PaymentStatus =
  | "REQUESTED" | "AUTHORIZATION_SCHEDULED" | "AUTHORIZATION_PENDING" | "AUTHORIZED" | "CAPTURE_PENDING"
  | "CAPTURED" | "ACTION_REQUIRED" | "FAILED" | "CANCELLATION_PENDING" | "CANCELLED" | "SUPERSEDED";

export type ContractorAction = "MARK_EN_ROUTE" | "MARK_ARRIVED" | "COMPLETE" | "FAIL_ACCESS" | "FAIL_SERVICE";

export interface TransitionContext {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  authorizationOverride: boolean;
  accessType: "ATTENDED" | "UNATTENDED";
  hasVerifiedProof: boolean;
  reason?: string;
}

export function transitionContractorJob(action: ContractorAction, context: TransitionContext): OrderStatus {
  if (action === "MARK_EN_ROUTE") {
    if (context.orderStatus !== "SCHEDULED") throw new Error("ILLEGAL_TRANSITION");
    if (context.paymentStatus !== "AUTHORIZED" && !context.authorizationOverride) throw new Error("PAYMENT_AUTHORIZATION_REQUIRED");
    return "EN_ROUTE";
  }
  if (action === "MARK_ARRIVED") {
    if (context.orderStatus !== "EN_ROUTE") throw new Error("ILLEGAL_TRANSITION");
    return "ARRIVED";
  }
  if (action === "COMPLETE") {
    if (context.orderStatus !== "ARRIVED") throw new Error("ILLEGAL_TRANSITION");
    if (context.accessType === "UNATTENDED" && !context.hasVerifiedProof) throw new Error("VERIFIED_PROOF_REQUIRED");
    return "SERVICE_COMPLETED";
  }
  if (!["SCHEDULED", "EN_ROUTE", "ARRIVED"].includes(context.orderStatus)) throw new Error("ILLEGAL_TRANSITION");
  if (!context.reason || context.reason.trim().length < 3) throw new Error("FAILURE_REASON_REQUIRED");
  return action === "FAIL_ACCESS" ? "FAILED_ACCESS" : "FAILED_SERVICE";
}
