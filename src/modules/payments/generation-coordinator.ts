import { canCaptureGeneration, scheduleAuthorization } from "@/modules/payments/model";
import type { CandidateEconomics } from "@/modules/pricing/money";

export type GenerationStatus =
  | "REQUESTED"
  | "AUTHORIZATION_SCHEDULED"
  | "AUTHORIZATION_PENDING"
  | "AUTHORIZED"
  | "CAPTURE_PENDING"
  | "CAPTURED"
  | "ACTION_REQUIRED"
  | "FAILED"
  | "CANCELLATION_PENDING"
  | "CANCELLED"
  | "SUPERSEDED";

export interface PaymentGenerationSnapshot {
  id: string;
  number: number;
  contractorId: string;
  connectedAccountId: string;
  status: GenerationStatus;
  isCurrent: boolean;
  assignmentActive: boolean;
  providerPaymentIntentId?: string;
  economics: CandidateEconomics;
}

export interface GenerationPaymentPort {
  authorize(generation: PaymentGenerationSnapshot): Promise<{
    paymentIntentId: string;
    status: "AUTHORIZED" | "ACTION_REQUIRED" | "FAILED";
  }>;
  cancel(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  capture(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}

/**
 * Deterministic application-domain model used by integration tests and fake
 * provider execution. PostgreSQL remains authoritative in production; this
 * model makes the contractor/destination generation invariant executable
 * without weakening the database transaction boundary.
 */
export class PaymentGenerationCoordinator {
  readonly generations: PaymentGenerationSnapshot[] = [];
  readonly audit: string[] = [];

  constructor(private readonly port: GenerationPaymentPort) {}

  assign(input: {
    contractorId: string;
    connectedAccountId: string;
    economics: CandidateEconomics;
    now: Date;
    serviceWindowStart: Date;
    authorizationLeadTimeMinutes: number;
    timingKind: "SCHEDULED" | "EARLIEST" | "URGENT";
  }): PaymentGenerationSnapshot {
    if (this.current) throw new Error("ACTIVE_ASSIGNMENT_EXISTS");
    if (input.economics.contractorPayoutCents > input.economics.customerTotalCents) throw new Error("PAYOUT_NOT_FUNDED");
    const schedule = scheduleAuthorization({
      now: input.now,
      serviceWindowStart: input.serviceWindowStart,
      authorizationLeadTimeMinutes: input.authorizationLeadTimeMinutes,
      timingKind: input.timingKind,
      hasAssignment: true,
    });
    const generation: PaymentGenerationSnapshot = {
      id: `generation-${this.generations.length + 1}`,
      number: this.generations.length + 1,
      contractorId: input.contractorId,
      connectedAccountId: input.connectedAccountId,
      status: schedule.immediate ? "REQUESTED" : "AUTHORIZATION_SCHEDULED",
      isCurrent: true,
      assignmentActive: true,
      economics: input.economics,
    };
    this.generations.push(generation);
    this.audit.push(`ASSIGNED:${generation.id}:${input.contractorId}`);
    return generation;
  }

  get current(): PaymentGenerationSnapshot | undefined {
    return this.generations.find((generation) => generation.isCurrent);
  }

  async authorizeCurrent(): Promise<PaymentGenerationSnapshot> {
    const generation = this.current;
    if (!generation || !generation.assignmentActive) throw new Error("CURRENT_ASSIGNMENT_REQUIRED");
    if (!["REQUESTED", "AUTHORIZATION_SCHEDULED", "ACTION_REQUIRED"].includes(generation.status)) throw new Error("GENERATION_NOT_AUTHORIZABLE");
    generation.status = "AUTHORIZATION_PENDING";
    const result = await this.port.authorize(generation);
    generation.providerPaymentIntentId = result.paymentIntentId;
    generation.status = result.status;
    this.audit.push(`AUTHORIZATION:${generation.id}:${result.status}`);
    return generation;
  }

  async reassign(input: Parameters<PaymentGenerationCoordinator["assign"]>[0]): Promise<PaymentGenerationSnapshot> {
    const old = this.current;
    if (!old) return this.assign(input);
    if (old.status === "CAPTURED") throw new Error("CAPTURED_PAYMENT_REQUIRES_MANUAL_RECOVERY");

    // Releasing the assignment first blocks both parties from service actions.
    old.assignmentActive = false;
    this.audit.push(`ASSIGNMENT_RELEASED:${old.id}`);
    if (old.providerPaymentIntentId) {
      old.status = "CANCELLATION_PENDING";
      await this.port.cancel(old.providerPaymentIntentId, `cancel:${old.id}`);
      old.status = "CANCELLED";
      this.audit.push(`AUTHORIZATION_CANCELLED:${old.id}`);
    }
    old.status = "SUPERSEDED";
    old.isCurrent = false;
    this.audit.push(`SUPERSEDED:${old.id}`);
    return this.assign(input);
  }

  async captureCurrent(): Promise<void> {
    const generation = this.current;
    if (!generation || !generation.providerPaymentIntentId || !canCaptureGeneration(generation)) throw new Error("GENERATION_NOT_CAPTURABLE");
    await this.port.capture(generation.providerPaymentIntentId, `capture:${generation.id}`);
    generation.status = "CAPTURED";
    this.audit.push(`CAPTURED:${generation.id}:${generation.contractorId}`);
  }
}
