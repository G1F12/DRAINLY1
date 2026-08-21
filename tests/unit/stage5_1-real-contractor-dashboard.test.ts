import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/app/contractor/page.tsx", "utf8");
const accept = readFileSync("src/app/api/contractor/offers/[id]/accept/route.ts", "utf8");
const decline = readFileSync("src/app/api/contractor/offers/[id]/decline/route.ts", "utf8");
const jobAction = readFileSync("src/app/api/contractor/jobs/[id]/action/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260821140347_stage5_1_real_contractor_dashboard_security.sql", "utf8");

describe("Stage 5.1 real contractor dashboard", () => {
  it("uses auth-real Supabase reads independently from core provider mode", () => {
    expect(dashboard).toContain("createSupabaseAuthClient");
    expect(dashboard).toContain('env.AUTH_PROVIDER_MODE !== "real" && env.PROVIDER_MODE !== "real"');
    expect(dashboard).toContain('redirect("/contractor/onboarding")');
    expect(dashboard).not.toContain("offerResult.data?.length ? offerResult.data : demoOffers()");
    expect(dashboard).not.toContain("jobResult.data?.length ? jobResult.data : demoJobs()");
  });

  it("shows pending real contractors a real status page instead of demo work", () => {
    expect(dashboard).toContain("Your profile is under review.");
    expect(dashboard).toContain("No demo offers or jobs are shown for real authenticated contractor accounts.");
    expect(dashboard).toContain("Continue contractor setup");
  });

  it("keeps mutation controls locked until the controlled pilot is actually open", () => {
    expect(dashboard).toContain("contractorActionsEnabled");
    expect(dashboard).toContain("bookingExecutionEnabled");
    expect(dashboard).toContain("paymentExecutionEnabled");
    expect(dashboard).toContain("Pilot locked");
    for (const route of [accept, decline, jobAction]) {
      expect(route).toContain("Controlled contractor pilot actions are not enabled");
    }
  });

  it("repairs contractor tenant predicates and explicitly scopes the two operational views", () => {
    expect(migration).toContain("member.contractor_company_id = order_offers.contractor_company_id");
    expect(migration).toContain("member.contractor_company_id = order_assignments.contractor_company_id");
    expect(migration).toContain("assignment.order_id = orders.id");
    expect(migration).toContain("member.contractor_company_id = oo.contractor_company_id");
    expect(migration).toContain("member.contractor_company_id = oa.contractor_company_id");
    expect(migration).toContain("member.auth_user_id = identity.uid()");
    expect(migration).not.toContain("cu.contractor_company_id = cu.contractor_company_id");
    expect(migration).not.toContain("oa.order_id = oa.id");
  });
});
