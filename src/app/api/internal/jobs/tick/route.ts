import { apiError, constantTimeSecretMatches, hashRateLimitKey } from "@/lib/http";
import { log } from "@/lib/logger";
import { getServerEnv } from "@/lib/env";
import { getSystemDb } from "@/lib/system-db";
import { getPaymentGateway } from "@/modules/payments/gateway";
import { getNotificationGateway } from "@/modules/notifications/gateway";
import type { CandidateEconomics } from "@/modules/pricing/money";
import { notificationCopy } from "@/modules/notifications/templates";
import { withOutboundProviderTimeout } from "@/modules/notifications/delivery-limits";

interface WorkItem { id: string; taskType: string; aggregateId: string; payload: Record<string, unknown> }
interface OutboxItem { id: string; topic: string; aggregateId: string; payload: Record<string, unknown> }
interface OutboxContext { outboxId: string; topic: string; orderId: string; publicRef: string; customerEmail: string; customerPhone?: string; contractorEmail?: string; contractorPhone?: string }
interface PaymentContext extends CandidateEconomics {
  paymentGenerationId: string; orderId: string; assignmentId: string; isCurrent: boolean; status: string;
  connectedAccountId: string; stripeCustomerId: string; paymentMethodId: string; providerPaymentIntentId?: string;
  shouldRun?: boolean;
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!constantTimeSecretMatches(token, getServerEnv().CRON_SECRET)) return apiError("FORBIDDEN", "Invalid worker credential", 403);
  const sql = getSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Worker database connection is not configured", 503);
  const workerId = `next-${crypto.randomUUID()}`;
  const work = await sql<WorkItem[]>`select * from internal.claim_due_work(${workerId}, ${20})`;
  const results: Array<{ id: string; succeeded: boolean; error?: string }> = [];
  for (const item of work) {
    let attemptId: string | undefined;
    let providerObjectId: string | undefined;
    try {
      if (["AUTHORIZE_PAYMENT", "CAPTURE_PAYMENT", "CANCEL_AUTHORIZATION", "CANCEL_ORDER_AUTHORIZATION"].includes(item.taskType)) {
        const rows = item.taskType === "AUTHORIZE_PAYMENT"
          ? await sql<{ context: PaymentContext }[]>`select internal.begin_authorization(${item.aggregateId}::uuid) as context`
          : await sql<{ context: PaymentContext }[]>`select internal.get_payment_operation_context(${item.aggregateId}::uuid) as context`;
        const context = rows[0]?.context;
        if (!context) throw new Error("PAYMENT_CONTEXT_NOT_FOUND");
        if (item.taskType === "AUTHORIZE_PAYMENT" && context.shouldRun !== true) {
          await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
          results.push({ id: item.id, succeeded: true });
          continue;
        }
        if (item.taskType === "CAPTURE_PAYMENT" && (!context.isCurrent || context.status !== "CAPTURE_PENDING")) {
          await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
          results.push({ id: item.id, succeeded: true });
          continue;
        }
        if (["CANCEL_AUTHORIZATION", "CANCEL_ORDER_AUTHORIZATION"].includes(item.taskType)
          && (!context.isCurrent || !["CANCELLATION_PENDING", "CANCELLED"].includes(context.status))) {
          await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
          results.push({ id: item.id, succeeded: true });
          continue;
        }
        const operation = item.taskType === "AUTHORIZE_PAYMENT" ? "AUTHORIZE" : item.taskType === "CAPTURE_PAYMENT" ? "CAPTURE" : "CANCEL";
        const attempts = await sql<{ attemptId: string }[]>`select internal.begin_payment_attempt(${context.paymentGenerationId}::uuid, ${operation}, ${`${operation.toLowerCase()}:${context.paymentGenerationId}`}) as attempt_id`;
        attemptId = attempts[0]?.attemptId;
        if (item.taskType === "AUTHORIZE_PAYMENT") {
          const authorization = await getPaymentGateway().authorize({
            orderId: context.orderId,
            paymentGenerationId: context.paymentGenerationId,
            connectedAccountId: context.connectedAccountId,
            stripeCustomerId: context.stripeCustomerId,
            paymentMethodId: context.paymentMethodId,
            economics: context,
            idempotencyKey: `authorize:${context.paymentGenerationId}`,
          });
          providerObjectId = authorization.paymentIntentId;
          await sql`select internal.record_authorization_result(${context.paymentGenerationId}::uuid, ${authorization.paymentIntentId}, ${authorization.status}::domain.payment_generation_status, ${authorization.captureBefore?.toISOString() ?? null}::timestamptz, ${authorization.status === "FAILED" ? "AUTHORIZATION_FAILED" : null})`;
        } else if (item.taskType === "CAPTURE_PAYMENT") {
          if (!context.providerPaymentIntentId) throw new Error("PAYMENT_INTENT_NOT_CREATED");
          await getPaymentGateway().capture(context.providerPaymentIntentId, `capture:${context.paymentGenerationId}`);
          providerObjectId = context.providerPaymentIntentId;
          if (getServerEnv().PROVIDER_MODE === "fake") {
            const eventId = `evt_fake_capture_${context.paymentGenerationId.replace(/-/g, "")}`;
            await sql`select internal.process_payment_webhook(${eventId}, ${"payment_intent.succeeded"}, ${false}, ${"fake-payload-sha256"}, ${context.providerPaymentIntentId}, ${Math.ceil(context.customerTotalCents * 0.03) + 30})`;
          }
        } else {
          if (!context.providerPaymentIntentId) throw new Error("PAYMENT_INTENT_NOT_CREATED");
          if (context.status !== "CANCELLED") {
            await getPaymentGateway().cancelAuthorization(context.providerPaymentIntentId, `cancel:${context.paymentGenerationId}`);
          }
          providerObjectId = context.providerPaymentIntentId;
          if (item.taskType === "CANCEL_ORDER_AUTHORIZATION") {
            await sql`select internal.record_order_cancellation_release(${context.paymentGenerationId}::uuid)`;
          } else {
            await sql`select internal.record_cancellation_and_finalize(${context.paymentGenerationId}::uuid)`;
          }
        }
      } else if (item.taskType === "RECONCILE_PAYMENT") {
        const rows = await sql<{ context: PaymentContext }[]>`select internal.get_payment_operation_context(${item.aggregateId}::uuid) as context`;
        const context = rows[0]?.context;
        if (!context?.providerPaymentIntentId) throw new Error("RECONCILIATION_PAYMENT_CONTEXT_NOT_FOUND");
        const fee = await getPaymentGateway().processingFeeForPaymentIntent(context.providerPaymentIntentId);
        if (fee === null) throw new Error("PROCESSING_FEE_NOT_AVAILABLE");
        await sql`select internal.record_reconciliation_result(${context.paymentGenerationId}::uuid, ${fee})`;
      } else if (item.taskType === "REFUND_PAYMENT") {
        const rows = await sql<{ context: { refundId: string; orderId: string; paymentGenerationId: string; paymentIntentId?: string; providerPaymentIntentId: string; amountCents: number; customerTotalCents: number; stripeTransferAmountCents: number; reason: string; idempotencyKey: string } }[]>`
          select internal.get_refund_context(${item.aggregateId}::uuid) as context
        `;
        const context = rows[0]?.context;
        if (!context?.providerPaymentIntentId) throw new Error("REFUND_PAYMENT_CONTEXT_NOT_FOUND");
        const attempts = await sql<{ attemptId: string }[]>`select internal.begin_payment_attempt(${context.paymentGenerationId}::uuid, ${"REFUND"}, ${`refund:${context.refundId}`}) as attempt_id`;
        attemptId = attempts[0]?.attemptId;
        const refund = await getPaymentGateway().refund({ paymentIntentId: context.providerPaymentIntentId, amountCents: context.amountCents, customerTotalCents: context.customerTotalCents, stripeTransferAmountCents: context.stripeTransferAmountCents, reason: context.reason, idempotencyKey: context.idempotencyKey });
        providerObjectId = refund.refundId;
        await sql`select internal.record_refund_result(${context.refundId}::uuid, ${refund.refundId}, ${refund.status === "succeeded" ? "SUCCEEDED" : "PENDING"}::domain.refund_status, ${refund.transferReversalCents}::integer, ${null}::text)`;
      } else if (item.taskType === "CHECK_ASSIGNMENT_DEADLINE") {
        await sql`select internal.process_assignment_deadline(${item.aggregateId}::uuid)`;
      } else if (item.taskType === "SEND_SERVICE_REMINDER") {
        await sql`select internal.enqueue_service_reminder(${item.aggregateId}::uuid)`;
      } else {
        throw new Error("UNKNOWN_SCHEDULED_TASK_TYPE");
      }
      if (attemptId) await sql`select internal.complete_payment_attempt(${attemptId}::uuid, ${true}, ${providerObjectId ?? null}, ${null})`;
      await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
      results.push({ id: item.id, succeeded: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker failure";
      if (attemptId) {
        try { await sql`select internal.complete_payment_attempt(${attemptId}::uuid, ${false}, ${providerObjectId ?? null}, ${message})`; } catch { /* Preserve the original worker error. */ }
      }
      await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${false}, ${message})`;
      results.push({ id: item.id, succeeded: false, error: message });
    }
  }
  const outbox = await sql<OutboxItem[]>`select * from internal.claim_outbox(${workerId}, ${20})`;
  const notificationResults: Array<{ id: string; succeeded: boolean; error?: string }> = [];
  for (const item of outbox) {
    try {
      const rows = await sql<{ context: OutboxContext }[]>`select internal.get_outbox_delivery_context(${item.id}::uuid, ${workerId}) as context`;
      const context = rows[0]?.context;
      if (!context) throw new Error("OUTBOX_CONTEXT_NOT_FOUND");
      const recipients: Array<{ type: "CUSTOMER" | "CONTRACTOR" | "ADMIN"; email: string }> = [];
      if (["payment.dispute_alert", "payment.operation_failed", "payment.reconciliation_discrepancy"].includes(item.topic)) {
        const ops = getServerEnv().OPS_ALERT_EMAIL;
        if (ops) recipients.push({ type: "ADMIN", email: ops });
        else log("error", item.topic, { orderId: context.orderId, outboxId: item.id });
      } else {
        recipients.push({ type: "CUSTOMER", email: context.customerEmail });
        if (["assignment.deadline_missed", "order.failed_service"].includes(item.topic)) {
          const ops = getServerEnv().OPS_ALERT_EMAIL;
          if (ops) recipients.push({ type: "ADMIN", email: ops });
          else log("warn", "notification.ops_recipient_missing", { topic: item.topic, orderId: context.orderId });
        }
        if (["assignment.created", "order.cancelled", "order.service_reminder"].includes(item.topic) && context.contractorEmail) recipients.push({ type: "CONTRACTOR", email: context.contractorEmail });
      }
      for (const recipient of recipients) {
        const destinationHash = hashRateLimitKey(`notification:${recipient.email.toLowerCase()}`);
        const deliveries = await sql<{ delivery: { notificationId: string; shouldSend: boolean; idempotencyKey: string } }[]>`
          select internal.begin_notification_delivery(${item.id}::uuid, ${context.orderId}::uuid, ${recipient.type}, ${"EMAIL"}, ${item.topic}, ${destinationHash}) as delivery
        `;
        const delivery = deliveries[0]?.delivery;
        if (!delivery?.shouldSend) continue;
        try {
          const copy = notificationCopy(item.topic, context.publicRef, recipient.type);
          const sendResult = await withOutboundProviderTimeout((signal) => getNotificationGateway().sendEmail({
            to: recipient.email,
            subject: copy.subject,
            body: copy.body,
            idempotencyKey: delivery.idempotencyKey,
          }, signal), getServerEnv().OUTBOUND_PROVIDER_TIMEOUT_MS);
          await sql`select internal.record_notification_provider_message(
            ${delivery.notificationId}::uuid,
            ${sendResult.provider},
            ${sendResult.providerMessageId}
          )`;
          await sql`select internal.complete_notification_delivery(${delivery.notificationId}::uuid, ${true}, ${null})`;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Notification provider failed";
          await sql`select internal.complete_notification_delivery(${delivery.notificationId}::uuid, ${false}, ${message})`;
          throw error;
        }
      }
      await sql`select internal.complete_outbox(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
      notificationResults.push({ id: item.id, succeeded: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification failure";
      await sql`select internal.complete_outbox(${item.id}::uuid, ${workerId}, ${false}, ${message})`;
      notificationResults.push({ id: item.id, succeeded: false, error: message });
    }
  }
  return Response.json({ claimed: work.length, results, outboxClaimed: outbox.length, notificationResults });
}
