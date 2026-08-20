import { createHash } from "node:crypto";

import { Resend } from "resend";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { apiError } from "@/lib/http";
import { getNotificationSystemDb } from "@/lib/system-db";

const eventSchema = z.object({
  type: z.enum([
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.failed",
    "email.suppressed",
  ]),
  created_at: z.string().min(10),
  data: z.object({ email_id: z.string().min(3) }).passthrough(),
}).passthrough();

export async function POST(request: Request) {
  const env = getServerEnv();
  if (env.NOTIFICATION_PROVIDER_MODE !== "real") {
    return Response.json({ received: true, ignored: true, demo: true });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature || !env.RESEND_WEBHOOK_SECRET || !env.RESEND_API_KEY) {
    return apiError("BAD_REQUEST", "Resend webhook signature headers are required", 400);
  }

  const payload = await request.text();
  let event: z.infer<typeof eventSchema>;
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const verified = resend.webhooks.verify({
      payload,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    });
    event = eventSchema.parse(verified);
  } catch {
    return apiError("FORBIDDEN", "Invalid Resend webhook signature", 400);
  }

  const occurredAt = new Date(event.created_at);
  if (Number.isNaN(occurredAt.getTime())) {
    return apiError("BAD_REQUEST", "Invalid Resend webhook timestamp", 400);
  }

  const sql = getNotificationSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Notification webhook persistence is unavailable", 503);
  const payloadSha256 = createHash("sha256").update(payload).digest("hex");
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select internal.process_resend_webhook(
      ${svixId},
      ${event.type},
      ${event.data.email_id},
      ${occurredAt.toISOString()}::timestamptz,
      ${payloadSha256}
    ) as result
  `;
  return Response.json(rows[0]?.result ?? { processed: true });
}
