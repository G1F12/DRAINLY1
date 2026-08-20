import "server-only";

import Stripe from "stripe";

import { getServerEnv } from "@/lib/env";
import { destinationPaymentIntentParams, type DestinationAuthorizationInput } from "@/modules/payments/model";

export interface SetupResult { customerId: string; setupIntentId: string; clientSecret: string; paymentMethodId?: string }
export interface VerifiedSetupIntent { customerId: string; setupIntentId: string; paymentMethodId: string; status: "succeeded"; usage: "off_session" }
export interface AuthorizationResult { paymentIntentId: string; status: "AUTHORIZED" | "AUTHORIZATION_PENDING" | "ACTION_REQUIRED" | "FAILED"; captureBefore: Date | null; clientSecret?: string }
export interface RefundResult { refundId: string; status: string; amountCents: number; transferReversalCents: number | null }

export interface PaymentGateway {
  createSetupIntent(input: { email: string; existingCustomerId?: string; idempotencyKey: string }): Promise<SetupResult>;
  verifySetupIntent(setupIntentId: string): Promise<VerifiedSetupIntent>;
  authorize(input: DestinationAuthorizationInput & { idempotencyKey: string }): Promise<AuthorizationResult>;
  cancelAuthorization(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  capture(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  refund(input: { paymentIntentId: string; amountCents: number; customerTotalCents: number; stripeTransferAmountCents: number; idempotencyKey: string; reason: string }): Promise<RefundResult>;
  refundStatus(refundId: string): Promise<RefundResult>;
  processingFeeForPaymentIntent(paymentIntentId: string): Promise<number | null>;
  paymentIntentForCharge(chargeId: string): Promise<string | null>;
  constructWebhook(payload: string | Buffer, signature: string): Stripe.Event;
}

export class FakePaymentGateway implements PaymentGateway {
  private readonly statuses = new Map<string, string>();
  private readonly setupIntents = new Map<string, VerifiedSetupIntent>();
  private readonly processingFees = new Map<string, number>();
  private readonly refunds = new Map<string, RefundResult>();

  async createSetupIntent(input: { email: string; existingCustomerId?: string; idempotencyKey: string }): Promise<SetupResult> {
    const suffix = input.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
    const result = { customerId: input.existingCustomerId ?? `cus_fake_${suffix}`, setupIntentId: `seti_fake_${suffix}`, clientSecret: `seti_fake_${suffix}_secret_test`, paymentMethodId: `pm_fake_${suffix}` };
    this.setupIntents.set(result.setupIntentId, { customerId: result.customerId, setupIntentId: result.setupIntentId, paymentMethodId: result.paymentMethodId, status: "succeeded", usage: "off_session" });
    return result;
  }

  async verifySetupIntent(setupIntentId: string): Promise<VerifiedSetupIntent> {
    const setup = this.setupIntents.get(setupIntentId);
    if (!setup) throw new Error("SETUP_INTENT_NOT_CONFIRMED");
    return setup;
  }

  async authorize(input: DestinationAuthorizationInput & { idempotencyKey: string }): Promise<AuthorizationResult> {
    const params = destinationPaymentIntentParams(input);
    if ("application_fee_amount" in params) throw new Error("APPLICATION_FEE_NOT_ALLOWED");
    const id = `pi_fake_${input.paymentGenerationId.replace(/-/g, "").slice(0, 20)}`;
    this.statuses.set(id, "requires_capture");
    this.processingFees.set(id, Math.ceil(input.economics.customerTotalCents * 0.03) + 30);
    return { paymentIntentId: id, status: "AUTHORIZED", captureBefore: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000) };
  }

  async cancelAuthorization(paymentIntentId: string): Promise<void> { this.statuses.set(paymentIntentId, "canceled"); }
  async capture(paymentIntentId: string): Promise<void> {
    if (this.statuses.get(paymentIntentId) === "canceled") throw new Error("AUTHORIZATION_CANCELLED");
    this.statuses.set(paymentIntentId, "succeeded");
  }
  async refund(input: { paymentIntentId: string; amountCents: number; customerTotalCents: number; stripeTransferAmountCents: number; idempotencyKey: string }): Promise<RefundResult> {
    const result = {
      refundId: `re_fake_${input.idempotencyKey.replace(/\W/g, "").slice(0, 20)}`,
      status: "succeeded",
      amountCents: input.amountCents,
      transferReversalCents: Math.floor((input.stripeTransferAmountCents * input.amountCents) / input.customerTotalCents),
    };
    this.refunds.set(result.refundId, result);
    return result;
  }
  async refundStatus(refundId: string): Promise<RefundResult> {
    const refund = this.refunds.get(refundId);
    if (!refund) throw new Error("REFUND_NOT_FOUND");
    return refund;
  }
  async processingFeeForPaymentIntent(paymentIntentId: string): Promise<number | null> { return this.processingFees.get(paymentIntentId) ?? null; }
  async paymentIntentForCharge(): Promise<string | null> { return null; }
  constructWebhook(payload: string | Buffer): Stripe.Event { return JSON.parse(payload.toString()) as Stripe.Event; }
}

export class StripePaymentGateway implements PaymentGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string, private readonly webhookSecret: string) {
    if (!secretKey.startsWith("sk_test_")) throw new Error("Only Stripe test-mode keys are allowed");
    this.stripe = new Stripe(secretKey, { appInfo: { name: "Drainly", version: "0.1.0" } });
  }

  async createSetupIntent(input: { email: string; existingCustomerId?: string; idempotencyKey: string }): Promise<SetupResult> {
    const customerId = input.existingCustomerId ?? (await this.stripe.customers.create({ email: input.email }, { idempotencyKey: `${input.idempotencyKey}:customer` })).id;
    const intent = await this.stripe.setupIntents.create({ customer: customerId, usage: "off_session", automatic_payment_methods: { enabled: true } }, { idempotencyKey: input.idempotencyKey });
    if (!intent.client_secret) throw new Error("STRIPE_SETUP_INTENT_MISSING_SECRET");
    return { customerId, setupIntentId: intent.id, clientSecret: intent.client_secret };
  }

  async verifySetupIntent(setupIntentId: string): Promise<VerifiedSetupIntent> {
    const intent = await this.stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
    const customerId = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
    const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    if (intent.status !== "succeeded" || intent.usage !== "off_session" || !customerId || !paymentMethodId) throw new Error("SETUP_INTENT_NOT_CONFIRMED");
    return { customerId, setupIntentId: intent.id, paymentMethodId, status: "succeeded", usage: "off_session" };
  }

  async authorize(input: DestinationAuthorizationInput & { idempotencyKey: string }): Promise<AuthorizationResult> {
    const intent = await this.stripe.paymentIntents.create(destinationPaymentIntentParams(input), { idempotencyKey: input.idempotencyKey });
    const captureBeforeEpoch = intent.latest_charge && typeof intent.latest_charge !== "string"
      ? intent.latest_charge.payment_method_details?.card?.capture_before
      : null;
    return {
      paymentIntentId: intent.id,
      status: intent.status === "requires_capture" ? "AUTHORIZED" : intent.status === "requires_action" ? "ACTION_REQUIRED" : intent.status === "processing" ? "AUTHORIZATION_PENDING" : "FAILED",
      captureBefore: captureBeforeEpoch ? new Date(captureBeforeEpoch * 1000) : null,
      clientSecret: intent.status === "requires_action" ? intent.client_secret ?? undefined : undefined,
    };
  }

  async cancelAuthorization(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey });
  }
  async capture(paymentIntentId: string, idempotencyKey: string): Promise<void> {
    await this.stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey });
  }
  async refund(input: { paymentIntentId: string; amountCents: number; customerTotalCents: number; stripeTransferAmountCents: number; idempotencyKey: string; reason: string }): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({ payment_intent: input.paymentIntentId, amount: input.amountCents, reverse_transfer: true, metadata: { drainlyReason: input.reason }, expand: ["transfer_reversal"] }, { idempotencyKey: input.idempotencyKey });
    const reversal = refund.transfer_reversal;
    return { refundId: refund.id, status: refund.status ?? "pending", amountCents: refund.amount, transferReversalCents: reversal && typeof reversal !== "string" ? reversal.amount : null };
  }
  async refundStatus(refundId: string): Promise<RefundResult> {
    const refund = await this.stripe.refunds.retrieve(refundId, { expand: ["transfer_reversal"] });
    const reversal = refund.transfer_reversal;
    return { refundId: refund.id, status: refund.status ?? "pending", amountCents: refund.amount,
      transferReversalCents: reversal && typeof reversal !== "string" ? reversal.amount : null };
  }
  async processingFeeForPaymentIntent(paymentIntentId: string): Promise<number | null> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string") return null;
    const transaction = charge.balance_transaction;
    return transaction && typeof transaction !== "string" ? transaction.fee : null;
  }
  async paymentIntentForCharge(chargeId: string): Promise<string | null> {
    const charge = await this.stripe.charges.retrieve(chargeId);
    return typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  }
  constructWebhook(payload: string | Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
  }
}

let gateway: PaymentGateway | undefined;
export function getPaymentGateway(): PaymentGateway {
  const env = getServerEnv();
  gateway ??= env.PROVIDER_MODE === "real"
    ? new StripePaymentGateway(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET!)
    : new FakePaymentGateway();
  return gateway;
}
