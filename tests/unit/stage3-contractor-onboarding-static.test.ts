import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auth = readFileSync("src/lib/supabase/auth.ts", "utf8");
const route = readFileSync("src/app/api/contractor/onboarding/route.ts", "utf8");
const page = readFileSync("src/app/contractor/onboarding/page.tsx", "utf8");
const marketing = readFileSync("src/app/contractors/page.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260820210840_stage3_contractor_self_onboarding.sql", "utf8");

describe("stage 3 contractor onboarding source invariants", () => {
  it("uses the auth-scoped Supabase client without enabling core provider mode", () => {
    expect(auth).toContain("export async function createSupabaseAuthClient()");
    expect(route).toContain("createSupabaseAuthClient");
    expect(route).not.toContain("createSupabaseServerClient");
    expect(route).not.toContain('PROVIDER_MODE === "real"');
  });

  it("requires authenticated, same-origin, idempotent writes", () => {
    expect(route).toContain("requireSameOrigin(request)");
    expect(route).toContain("getIdempotencyKey(request)");
    expect(route).toContain("client.auth.getUser()");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("CONTRACTOR_ONBOARDING_SAVED");
  });

  it("creates real supply records but keeps new companies pending", () => {
    expect(migration).toContain("'PENDING'");
    expect(migration).toContain("contractor_service_regions");
    expect(migration).toContain("contractor_availability");
    expect(migration).toContain("contractor_price_books");
    expect(migration).toContain("contractor_price_rules");
    expect(migration).toContain("'SUBMITTED'");
    expect(migration).not.toContain("stripe_connected_account_id =");
  });

  it("keeps contractor pricing contractor-defined and covers the supported tank tiers", () => {
    for (const tier of ["GAL_750", "GAL_1000", "GAL_1250", "GAL_1500"]) {
      expect(migration).toContain(tier);
    }
    expect(migration).toContain("'EARLIEST', v_scheduled_cents");
    expect(migration).toContain("'URGENT', v_urgent_cents");
  });

  it("exposes a signed-in onboarding page and contractor CTA", () => {
    expect(page).toContain('redirect("/sign-in?next=/contractor/onboarding")');
    expect(marketing).toContain('href="/contractor/onboarding"');
  });
});
