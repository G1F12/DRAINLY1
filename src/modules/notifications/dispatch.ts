import "server-only";

import { after } from "next/server";

import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { getNotificationSystemDb } from "@/lib/system-db";
import { runNotificationPipeline } from "@/modules/notifications/outbox";

export function scheduleNotificationDrain(): void {
  const env = getServerEnv();
  if (env.NOTIFICATION_PROVIDER_MODE !== "real") return;

  after(async () => {
    const sql = getNotificationSystemDb();
    if (!sql) {
      log("error", "notification.pipeline_database_unavailable");
      return;
    }
    try {
      await runNotificationPipeline(sql);
    } catch (error) {
      log("error", "notification.pipeline_failed", {
        error: error instanceof Error ? error.message : "UNKNOWN_NOTIFICATION_PIPELINE_FAILURE",
      });
    }
  });
}
