import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const systemDb = readFileSync("src/lib/system-db.ts", "utf8");
const gateway = readFileSync("src/modules/notifications/gateway.ts", "utf8");
const outbox = readFileSync("src/modules/notifications/outbox.ts", "utf8");
const resendWebhook = readFileSync("src/app/api/webhooks/resend/route.ts", "utf8");
const notificationTick = readFileSync("src/app/api/internal/notifications/tick/route.ts", "utf8");
const lifecycleMigration = readFileSync("supabase/migrations/20260820192240_stage2_notification_delivery_observability.sql", "utf8");
const reminderMigration = readFileSync("supabase/migrations/20260820192841_stage2_notification_reminder_worker.sql", "utf8");
const booking = readFileSync("src/app/api/bookings/route.ts", "utf8");
const offerAccept = readFileSync("src/app/api/contractor/offers/[id]/accept/route.ts", "utf8");
const jobAction = readFileSync("src/app/api/contractor/jobs/[id]/action/route.ts", "utf8");
const cancel = readFileSync("src/app/api/orders/[id]/cancel/route.ts", "utf8");

describe("Stage 2 notification invariants", () => {
  it("keeps notification real mode independent and fail-closed", () => {
    expect(env).toContain('NOTIFICATION_PROVIDER_MODE: z.enum(["fake", "real"]).default("fake")');
    expect(env).toContain('"RESEND_WEBHOOK_SECRET"');
    expect(systemDb).toContain("getNotificationSystemDb");
    expect(systemDb).toContain('env.NOTIFICATION_PROVIDER_MODE !== "real"');
  });

  it("records provider message IDs for delivery observability", () => {
    expect(gateway).toContain('provider: "RESEND"');
    expect(outbox).toContain("record_notification_provider_message");
    expect(lifecycleMigration).toContain("provider_message_id");
    expect(lifecycleMigration).toContain("process_resend_webhook");
  });

  it("verifies Resend webhooks against the raw body and Svix headers", () => {
    expect(resendWebhook).toContain("request.text()");
    expect(resendWebhook).toContain("resend.webhooks.verify");
    expect(resendWebhook).toContain('"svix-id"');
    expect(resendWebhook).toContain('"svix-timestamp"');
    expect(resendWebhook).toContain('"svix-signature"');
  });

  it("provides a GET notification worker for Vercel Cron", () => {
    expect(notificationTick).toContain("export const GET = handle");
    expect(notificationTick).toContain("runNotificationPipeline");
    expect(reminderMigration).toContain("claim_due_notification_work");
  });

  it("covers order lifecycle notifications and reminders", () => {
    for (const topic of [
      "order.en_route",
      "order.arrived",
      "order.service_completed",
      "order.closed",
      "order.cancelled",
      "order.failed_access",
      "order.failed_service",
      "order.service_reminder",
    ]) expect(lifecycleMigration).toContain(topic);
    expect(lifecycleMigration).toContain("SEND_SERVICE_REMINDER");
  });

  it("schedules a post-response drain after real business mutations", () => {
    for (const source of [booking, offerAccept, jobAction, cancel]) {
      expect(source).toContain("scheduleNotificationDrain");
    }
  });
});
