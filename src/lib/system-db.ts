import "server-only";

import postgres, { type Sql } from "postgres";

import { getServerEnv } from "@/lib/env";

let sql: Sql | null = null;

function getSharedSystemDb(connectionString: string): Sql {
  sql ??= postgres(connectionString, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return sql;
}

export function getSystemDb(): Sql | null {
  const env = getServerEnv();
  if (env.PROVIDER_MODE !== "real") return null;
  const connectionString = env.DRAINLY_SYSTEM_DATABASE_URL;
  if (!connectionString) return null;
  return getSharedSystemDb(connectionString);
}

export function getNotificationSystemDb(): Sql | null {
  const env = getServerEnv();
  if (env.NOTIFICATION_PROVIDER_MODE !== "real") return null;
  const connectionString = env.DRAINLY_SYSTEM_DATABASE_URL;
  if (!connectionString) return null;
  return getSharedSystemDb(connectionString);
}

export function getPaymentSystemDb(): Sql | null {
  const env = getServerEnv();
  if (env.PAYMENT_PROVIDER_MODE !== "stripe_test" && env.PROVIDER_MODE !== "real") return null;
  const connectionString = env.DRAINLY_SYSTEM_DATABASE_URL;
  if (!connectionString) return null;
  return getSharedSystemDb(connectionString);
}

export async function closeSystemDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
}
