import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is required for database integration tests.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 5, prepare: false });
try {
  await sql`select 1 as ready`;
} catch {
  console.error("TEST_DATABASE_URL is configured, but the test database is unavailable.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 }).catch(() => undefined);
}
