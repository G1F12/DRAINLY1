import { getServerEnv } from "@/lib/env";
import { apiError, constantTimeSecretMatches } from "@/lib/http";
import { getNotificationSystemDb } from "@/lib/system-db";
import { runNotificationPipeline } from "@/modules/notifications/outbox";

async function handle(request: Request) {
  const env = getServerEnv();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!constantTimeSecretMatches(token, env.CRON_SECRET)) {
    return apiError("FORBIDDEN", "Invalid notification worker credential", 403);
  }
  if (env.NOTIFICATION_PROVIDER_MODE !== "real") {
    return Response.json({ ignored: true, demo: true });
  }
  const sql = getNotificationSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Notification database connection is not configured", 503);
  return Response.json(await runNotificationPipeline(sql));
}

export const GET = handle;
export const POST = handle;
