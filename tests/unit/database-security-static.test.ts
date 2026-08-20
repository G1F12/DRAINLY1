import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync("supabase/migrations/202608110001_foundation.sql", "utf8");
const roles = readFileSync("supabase/roles.sql", "utf8");
const operations = readFileSync("supabase/migrations/202608110002_operations.sql", "utf8");
const auditFixes = readFileSync("supabase/migrations/202608110003_independent_audit_fixes.sql", "utf8");
const finalHardening = readFileSync("supabase/migrations/202608110004_final_audit_hardening.sql", "utf8");
const migrations = `${foundation}\n${operations}\n${auditFixes}\n${finalHardening}`;
const databaseTests = [
  readFileSync("supabase/tests/001_security_and_routines.sql", "utf8"),
  readFileSync("supabase/tests/002_privileged_routine_matrix.sql", "utf8"),
  readFileSync("supabase/tests/003_independent_audit_regressions.sql", "utf8"),
  readFileSync("supabase/tests/004_final_audit_hardening.sql", "utf8"),
].join("\n");

function privilegedRoutines() {
  const matches = migrations.matchAll(/create or replace function\s+((?:api|internal)\.[a-z0-9_]+)[\s\S]*?\$function\$;/gi);
  return [...matches].map((match) => ({ name: match[1]!.toLowerCase(), source: match[0] }));
}

describe("database exposure and privileged-routine source hardening", () => {
  it("bootstraps constrained Drainly roles as cluster globals and only validates them in migrations", () => {
    expect(roles).toMatch(/create role drainly_system login nosuperuser nocreatedb nocreaterole noreplication nobypassrls/i);
    expect(roles).toMatch(/create role drainly_routine_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls/i);
    expect(roles).not.toMatch(/alter role/i);
    expect(roles).toMatch(/grant drainly_system to postgres with inherit false, set true/i);
    expect(roles).toMatch(/grant drainly_routine_owner to postgres with inherit true, set true/i);
    expect(roles).not.toMatch(/grant\s+(?:all|select|insert|update|delete|truncate|references|trigger|usage|execute)\b/i);
    expect(foundation).not.toMatch(/alter role\s+drainly_(?:system|routine_owner)/i);
    expect(foundation).toContain("Unsafe role attributes for drainly_system");
    expect(foundation).toContain("Unsafe role attributes for drainly_routine_owner");
    expect(foundation).toContain("role_state.rolsuper");
    expect(foundation).toContain("role_state.rolbypassrls");
    expect(foundation).toContain("role_state.rolcanlogin");
  });

  it("exposes only api through PostgREST", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toMatch(/schemas\s*=\s*\["api"\]/);
    expect(config).not.toMatch(/schemas\s*=\s*\[[^\]]*(?:domain|internal)/);
  });

  it("gives every privileged routine an empty search path and explicit owner/revocation/test reference", () => {
    const routines = privilegedRoutines();
    expect(routines.length).toBeGreaterThan(25);
    for (const routine of routines) {
      expect(routine.source.toLowerCase(), routine.name).toContain("security definer");
      expect(routine.source.toLowerCase(), routine.name).toContain("set search_path = ''");
      expect(migrations.toLowerCase(), `${routine.name} owner`).toMatch(new RegExp(`alter function\\s+${routine.name.replace(".", "\\.")}\\([^;]+owner to drainly_routine_owner`));
      const namedRevoke = new RegExp(`revoke all on function\\s+${routine.name.replace(".", "\\.")}\\(`).test(migrations.toLowerCase());
      const schemaWideRevoke = /revoke all on all functions in schema api, internal from public/.test(migrations.toLowerCase());
      expect(namedRevoke || schemaWideRevoke, `${routine.name} public revoke`).toBe(true);
      expect(databaseTests.toLowerCase(), `${routine.name} database test`).toContain(routine.name);
    }
  });

  it("contains no forbidden payment or generic database-bypass semantics", () => {
    expect(migrations).not.toContain("application_fee_amount");
    expect(migrations).toContain("revoke all on function api.create_quote");
    expect(migrations).toContain("CHECK_ASSIGNMENT_DEADLINE");
    expect(migrations).toContain("ORDER_NOT_CANCELLABLE_AFTER_SERVICE");
    expect(migrations.toLowerCase()).not.toContain("service_role");
    expect(migrations.toLowerCase()).not.toMatch(/drainly_system\s+[^;]*\sbypassrls\b/);
    expect(migrations.toLowerCase()).not.toMatch(/drainly_routine_owner\s+[^;]*\sbypassrls\b/);
  });

  it("uses only the narrow native-Supabase identity bridge from privileged routines", () => {
    expect(foundation).toMatch(/create function identity\.uid\(\) returns uuid[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?select auth\.uid\(\)/i);
    expect(foundation).toMatch(/create function identity\.jwt\(\) returns jsonb[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?select auth\.jwt\(\)/i);
    expect(foundation).toContain("revoke all on function identity.uid(), identity.jwt() from public");
    expect(foundation).toContain("grant execute on function identity.uid(), identity.jwt() to drainly_routine_owner");
    expect(migrations.match(/auth\.(?:uid|jwt)\(\)/g)).toHaveLength(2);
    expect(migrations).not.toMatch(/grant\s+(?:select|insert|update|delete|all)[^;]*auth\./i);
    expect(databaseTests).toContain("routine owner has no auth.users table privilege");
  });

  it("makes append-only history structural and routine-owner privileges allowlisted", () => {
    for (const table of ["order_events", "audit_records", "financial_ledger_entries"]) {
      expect(foundation).toContain(`create trigger ${table.replace("financial_ledger_entries", "financial_ledger").replace("order_events", "order_events").replace("audit_records", "audit_records")}_append_only`);
    }
    expect(operations).toContain("revoke all privileges on all tables in schema domain, internal from drainly_routine_owner");
    expect(operations).not.toMatch(/grant\s+(?:all|delete)[^;]*to drainly_routine_owner/i);
  });

  it("removes released contractors from private proof-object access", () => {
    const storageSelectPolicy = foundation.match(/create policy job_proof_object_select[\s\S]*?\n\);/)?.[0] ?? "";
    expect(storageSelectPolicy).toContain("oa.released_at is null");
  });
});
