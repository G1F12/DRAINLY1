import { createHash } from "node:crypto";

import Stripe from "stripe";

import { getServerEnv } from "@/lib/env";
import { apiError } from "@/lib/http";
import { getSystemDb } from "@/lib/system-db";
import { scheduleNotificationDrain } from "@/modules/notifications/dispatch";
import { getPaymentGateway } from "@/modules/payments/gateway";

export async function POST(request: Request) {
  const env = getServerEnv();
  const stripeTestEnabled = env.PAYMENT_PROVIDER_MODE === "stripe_test";

  if (env.PROVIDER_MODE !== "real" && !stripeTestEnabled) {
    return Response.json({ received: true, ignored: true, demo: true });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return apiError("BAD_REQUEST", "Stripe signature is required", 400);

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getPaymentGateway().constructWebhook(payload, signature);
  } catch {
    return apiError("FORBIDDEN", "Invalid Stripe webhook signature", 400);
  }

  if (event.livemode) {
    return apiError("FORBIDDEN", "Live Stripe webhook events are not accepted", 400);
  }

  // Stage 5 test-payment boundary: signature verification is real, but no
  // payment/order state is persisted while the core marketplace is still fake.
  if (env.PROVIDER_MODE !== "real") {
    return Response.json({
      received: true,
      testMode: true,
      eventType: event.type,
    });
  }

  const sql = getSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Webhook persistence is unavailable", 503);

  scheduleNotificationDrain();
  const sha = createHash("sha256").update(payload).digest("hex");

  if (event.type.startsWith("charge.dispute.")) {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
    const paymentIntentId = typeof dispute.charge !== "string" && typeof dispute.charge.payment_intent === "string"
      ? dispute.charge.payment_intent
      : await getPaymentGateway().paymentIntentForCharge(chargeId);

    const result = await sql<{ result: Record<string, unknown> }[]>`
      select internal.process_dispute_webhook(${event.id}, ${event.type}, ${event.livemode}, ${sha}, ${dispute.id},
        ${paymentIntentId}, ${dispute.amount}, ${dispute.status}, ${0}) as result
    `;
    return Response.json(result[0]?.result ?? { received: true });
  }

  if (event.type.startsWith("refund.")) {
    const refundObject = event.data.object as Stripe.Refund;
    const refund = await getPaymentGateway().refundStatus(refundObject.id);
    const result = await sql<{ result: Record<string, unknown> }[]>`
      select internal.process_refund_webhook(${event.id}, ${event.type}, ${event.livemode}, ${sha},
        ${refund.refundId}, ${refund.status}, ${refund.transferReversalCents}) as result
    `;
    return Response.json(result[0]?.result ?? { received: true });
  }

  const object = event.data.object as Stripe.PaymentIntent;
  const paymentIntentId = object.object === "payment_intent" ? object.id : null;
  if (!paymentIntentId) return Response.json({ received: true, ignored: true });

  const processingFeeCents = event.type === "payment_intent.succeeded"
    ? await getPaymentGateway().processingFeeForPaymentIntent(paymentIntentId)
    : null;

  const result = await sql<{ result: Record<string, unknown> }[]>`
    select internal.process_payment_webhook(${event.id}, ${event.type}, ${event.livemode}, ${sha}, ${paymentIntentId}, ${processingFeeCents}) as result
  `;
  return Response.json(result[0]?.result ?? { received: true });
}
