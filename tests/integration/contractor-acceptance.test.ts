import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required for the contractor acceptance concurrency suite");
const databaseUrl = url;

describe("real PostgreSQL contractor acceptance race", () => {
  const admin = postgres(databaseUrl, { max: 5, prepare: false });
  afterAll(async () => admin.end());
  beforeAll(async () => {
    await admin.begin(async (tx) => {
      await tx`delete from domain.payment_operation_exceptions where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from internal.scheduled_tasks where aggregate_id in (
        select id from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001'
      ) or aggregate_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from internal.payment_attempts where payment_generation_id in (
        select id from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001'
      )`;
      await tx`delete from domain.financial_ledger_entries where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from domain.refunds where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from domain.job_proofs where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from domain.payment_generations where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`delete from domain.order_assignments where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`update domain.order_offers set status='OPEN', responded_at=null where order_id='91000000-0000-0000-0000-000000000001'`;
      await tx`update domain.orders set status='SEARCHING_CONTRACTOR' where id='91000000-0000-0000-0000-000000000001'`;
    });
  });

  async function accept(userId: string, offerId: string) {
    const connection = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      return await connection.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
        return tx`select api.accept_order_offer(${offerId}::uuid, ${`race-${crypto.randomUUID()}`})->>'assignmentId' as assignment_id`;
      });
    } finally { await connection.end(); }
  }

  it("allows exactly one winner with one assignment and one payment generation", async () => {
    const results = await Promise.allSettled([
      accept("20000000-0000-0000-0000-000000000001", "92000000-0000-0000-0000-000000000001"),
      accept("20000000-0000-0000-0000-000000000003", "92000000-0000-0000-0000-000000000002"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [counts] = await admin`select
      (select count(*)::int from domain.order_assignments where order_id = '91000000-0000-0000-0000-000000000001' and released_at is null) assignments,
      (select count(*)::int from domain.order_offers where order_id = '91000000-0000-0000-0000-000000000001' and status = 'ACCEPTED') accepted_offers,
      (select count(*)::int from domain.payment_generations where order_id = '91000000-0000-0000-0000-000000000001' and is_current) payment_generations`;
    expect(counts).toEqual({ assignments: 1, accepted_offers: 1, payment_generations: 1 });
  });
});
