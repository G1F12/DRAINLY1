import "server-only";

import postgres, { type Sql } from "postgres";

import { getServerEnv } from "@/lib/env";

let sql: Sql | null = null;

export function getSystemDb(): Sql | null {
  const connectionString = getServerEnv().DRAINLY_SYSTEM_DATABASE_URL;
  if (!connectionString) return null;
  sql ??= postgres(connectionString, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return sql;
}

export async function closeSystemDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
}
