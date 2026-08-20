import "server-only";

import { getSystemDb } from "@/lib/system-db";

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export async function consumeRateLimit(bucketKey: string, limit: number, windowSeconds: number): Promise<boolean> {
  const sql = getSystemDb();
  if (sql) {
    const rows = await sql<{ allowed: boolean }[]>`select internal.consume_rate_limit(${bucketKey}, ${limit}, ${windowSeconds}) as allowed`;
    return rows[0]?.allowed ?? false;
  }
  const now = Date.now();
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(bucketKey, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}
