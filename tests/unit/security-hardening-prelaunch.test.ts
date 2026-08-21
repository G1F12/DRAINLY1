import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { safeInternalPath } from "../../src/lib/navigation";

const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
const http = readFileSync("src/lib/http.ts", "utf8");
const rateLimit = readFileSync("src/lib/rate-limit.ts", "utf8");
const previewRoute = readFileSync("src/app/api/marketplace/match-preview/route.ts", "utf8");
const proofRoute = readFileSync("src/app/api/proofs/route.ts", "utf8");
const otpVerify = readFileSync("src/app/api/auth/verify/route.ts", "utf8");
const setupIntent = readFileSync("src/app/api/payments/setup-intent/route.ts", "utf8");
const rlsMigration = readFileSync(
  "supabase/migrations/20260821182719_security_hardening_rls_admin_view.sql",
  "utf8",
);
const trustedBoundaryMigration = readFileSync(
  "supabase/migrations/20260821183319_security_hardening_prepare_trusted_boundaries.sql",
  "utf8",
);
const previewRevokeMigration = readFileSync(
  "supabase/migrations/20260821185200_security_hardening_revoke_public_marketplace_preview.sql",
  "utf8",
);

describe("pre-launch security hardening", () => {
  it("rejects external and backslash-based post-auth redirects", () => {
    expect(safeInternalPath("https://evil.example")).toBe("/customer");
    expect(safeInternalPath("//evil.example")).toBe("/customer");
    expect(safeInternalPath("/\\evil.example")).toBe("/customer");
    expect(safeInternalPath("/admin/growth?range=30d")).toBe("/admin/growth?range=30d");
  });

  it("does not trust forwarded host headers for same-origin decisions", () => {
    expect(http).not.toContain('request.headers.get("x-forwarded-host")');
    expect(http).not.toContain('request.headers.get("x-forwarded-proto")');
  });

  it("uses a persistent trusted database for generic production rate limits", () => {
    expect(rateLimit).toContain("getSystemDb() ?? getGrowthSystemDb()");
    expect(otpVerify).toContain("otp-verify-ip:");
    expect(setupIntent).toContain("setup-intent-ip:");
  });

  it("moves marketplace preview behind the Next.js server boundary", () => {
    expect(previewRoute).toContain("getGrowthSystemDb()");
    expect(previewRoute).not.toContain("createSupabaseAuthClient");
    expect(trustedBoundaryMigration).toContain("GRANT EXECUTE ON FUNCTION api.marketplace_match_preview");
    expect(previewRevokeMigration).toContain("FROM anon, authenticated");
    expect(previewRevokeMigration).toContain("TO drainly_system");
  });

  it("binds proof finalization to the authenticated assigned contractor", () => {
    expect(proofRoute).toContain("get_proof_verification_context_for_actor");
    expect(proofRoute).toContain("verify_job_proof_for_actor");
    expect(proofRoute).toContain("${user.id}::uuid");
    expect(trustedBoundaryMigration).toContain("PROOF_FINALIZE_NOT_AUTHORIZED");
  });

  it("repairs tenant RLS and makes the operations overview admin-only", () => {
    expect(rlsMigration).toContain("assignment.order_id = order_events.order_id");
    expect(rlsMigration).toContain("member.contractor_company_id = quote_candidates.contractor_company_id");
    expect(rlsMigration).not.toContain("oa.order_id = oa.order_id");
    expect(rlsMigration).not.toContain("cu.contractor_company_id = cu.contractor_company_id");
    expect(rlsMigration).toContain("CREATE OR REPLACE VIEW api.admin_order_overview");
    expect(rlsMigration).toContain("admin_member.auth_user_id = identity.uid()");
  });

  it("requires real auth for the production operations console", () => {
    expect(adminPage).toContain("getAdminContext");
    expect(adminPage).toContain("allowDemoFallback");
    expect(adminPage).toContain('redirect("/sign-in?next=/admin")');
    expect(adminPage).toContain("robots: { index: false, follow: false }");
  });
});