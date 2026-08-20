import "server-only";

import type { Sql } from "postgres";

import { getServerEnv } from "@/lib/env";
import { hashRateLimitKey } from "@/lib/http";
import { log } from "@/lib/logger";
import { withOutboundProviderTimeout } from "@/modules/notifications/delivery-limits";
import { getNotificationGateway } from "@/modules/notifications/gateway";
import { notificationCopy, type NotificationRecipientType } from "@/modules/notifications/templates";

interface OutboxItem { id: string; topic: string; aggregateId: string; payload: Record<string, unknown> }
interface NotificationWorkItem { id: string; taskType: string; aggregateId: string; payload: Record<string, unknown> }
interface OutboxContext {
  outboxId: string;
  topic: string;
  orderId: string;
  publicRef: string;
  customerEmail: string;
  customerPhone?: string;
  contractorEmail?: string;
  contractorPhone?: string;
}
interface Recipient { type: NotificationRecipientType; email: string }

const OPS_ONLY = new Set([
  "payment.dispute_alert",
  "payment.operation_failed",
  "payment.reconciliation_discrepancy",
]);
const CUSTOMER_AND_OPS = new Set([
  "assignment.deadline_missed",
  "order.failed_service",
]);
const CONTRACTOR_TOO = new Set([
  "assignment.created",
  "order.cancelled",
  "order.service_reminder",
]);

function recipientsFor(topic: string, context: OutboxContext): Recipient[] {
  const opsEmail = getServerEnv().OPS_ALERT_EMAIL;
  if (OPS_ONLY.has(topic)) {
    if (!opsEmail) throw new Error("OPS_ALERT_EMAIL_NOT_CONFIGURED");
    return [{ type: "ADMIN", email: opsEmail }];
  }

  const recipients: Recipient[] = [{ type: "CUSTOMER", email: context.customerEmail }];
  if (CUSTOMER_AND_OPS.has(topic)) {
    if (opsEmail) recipients.push({ type: "ADMIN", email: opsEmail });
    else log("warn", "notification.ops_recipient_missing", { topic, orderId: context.orderId });
  }
  if (CONTRACTOR_TOO.has(topic) && context.contractorEmail) {
    recipients.push({ type: "CONTRACTOR", email: context.contractorEmail });
  }
  return recipients;
}

async function deliverEmail(
  sql: Sql,
  item: OutboxItem,
  context: OutboxContext,
  recipient: Recipient,
): Promise<void> {
  const destinationHash = hashRateLimitKey(`notification:${recipient.email.toLowerCase()}`);
  const deliveries = await sql<{ delivery: { notificationId: string; shouldSend: boolean; idempotencyKey: string } }[]>`
    select internal.begin_notification_delivery(
      ${item.id}::uuid,
      ${context.orderId}::uuid,
      ${recipient.type},
      ${"EMAIL"},
      ${item.topic},
      ${destinationHash}
    ) as delivery
  `;
  const delivery = deliveries[0]?.delivery;
  if (!delivery?.shouldSend) return;

  try {
    const copy = notificationCopy(item.topic, context.publicRef, recipient.type);
    const sendResult = await withOutboundProviderTimeout(
      (signal) => getNotificationGateway().sendEmail({
        to: recipient.email,
        subject: copy.subject,
        body: copy.body,
        idempotencyKey: delivery.idempotencyKey,
      }, signal),
      getServerEnv().OUTBOUND_PROVIDER_TIMEOUT_MS,
    );
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

export async function drainNotificationOutbox(sql: Sql, workerId = `notifications-${crypto.randomUUID()}`) {
  const outbox = await sql<OutboxItem[]>`select * from internal.claim_outbox(${workerId}, ${20})`;
  const notificationResults: Array<{ id: string; succeeded: boolean; error?: string }> = [];

  for (const item of outbox) {
    try {
      const rows = await sql<{ context: OutboxContext }[]>`
        select internal.get_outbox_delivery_context(${item.id}::uuid, ${workerId}) as context
      `;
      const context = rows[0]?.context;
      if (!context) throw new Error("OUTBOX_CONTEXT_NOT_FOUND");
      for (const recipient of recipientsFor(item.topic, context)) {
        await deliverEmail(sql, item, context, recipient);
      }
      await sql`select internal.complete_outbox(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
      notificationResults.push({ id: item.id, succeeded: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification failure";
      await sql`select internal.complete_outbox(${item.id}::uuid, ${workerId}, ${false}, ${message})`;
      notificationResults.push({ id: item.id, succeeded: false, error: message });
    }
  }

  return { outboxClaimed: outbox.length, notificationResults };
}

async function processDueNotificationWork(sql: Sql, workerId: string) {
  const work = await sql<NotificationWorkItem[]>`
    select * from internal.claim_due_notification_work(${workerId}, ${20})
  `;
  const results: Array<{ id: string; succeeded: boolean; error?: string }> = [];

  for (const item of work) {
    try {
      if (item.taskType !== "SEND_SERVICE_REMINDER") throw new Error("UNKNOWN_NOTIFICATION_TASK_TYPE");
      await sql`select internal.enqueue_service_reminder(${item.aggregateId}::uuid)`;
      await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${true}, ${null})`;
      results.push({ id: item.id, succeeded: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification work failure";
      await sql`select internal.complete_work(${item.id}::uuid, ${workerId}, ${false}, ${message})`;
      results.push({ id: item.id, succeeded: false, error: message });
    }
  }
  return { notificationWorkClaimed: work.length, notificationWorkResults: results };
}

export async function runNotificationPipeline(sql: Sql) {
  const workerId = `notifications-${crypto.randomUUID()}`;
  const work = await processDueNotificationWork(sql, workerId);
  const outbox = await drainNotificationOutbox(sql, workerId);
  return { ...work, ...outbox };
}
