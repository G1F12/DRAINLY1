import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDispatchPlan, rankMarketplaceCandidates } from "@/modules/dispatch/marketplace-ranking";

const migration = readFileSync("supabase/migrations/20260821102102_stage4_marketplace_matching_engine.sql", "utf8");
const matchRoute = readFileSync("src/app/api/marketplace/match-preview/route.ts", "utf8");
const quoteRoute = readFileSync("src/app/api/quotes/route.ts", "utf8");
const header = readFileSync("src/components/site-header.tsx", "utf8");
const headerActions = readFileSync("src/components/header-auth-actions.tsx", "utf8");
const logout = readFileSync("src/app/api/auth/logout/route.ts", "utf8");
const session = readFileSync("src/app/api/auth/session/route.ts", "utf8");

const candidates = [
  { id: "expensive", contractorGrossCents: 42000, assignedJobs: 0, maxJobs: 4, priority: 1, paymentReady: true },
  { id: "busy", contractorGrossCents: 35000, assignedJobs: 3, maxJobs: 4, priority: 1, paymentReady: false },
  { id: "open", contractorGrossCents: 35000, assignedJobs: 1, maxJobs: 4, priority: 50, paymentReady: false },
  { id: "full", contractorGrossCents: 30000, assignedJobs: 2, maxJobs: 2, priority: 1, paymentReady: true },
];

describe("stage 4 marketplace matching", () => {
  it("ranks by contractor price, then utilization, then priority", () => {
    expect(rankMarketplaceCandidates(candidates).map((candidate) => candidate.id))
      .toEqual(["open", "busy", "expensive"]);
  });

  it("uses one planned confirmation and up to three urgent offers", () => {
    const planned = buildDispatchPlan(candidates, "SCHEDULED");
    const urgent = buildDispatchPlan(candidates, "URGENT");
    expect(planned.mode).toBe("PLANNED_CONFIRMATION");
    expect(planned.offerWave).toHaveLength(1);
    expect(urgent.mode).toBe("URGENT_BROADCAST");
    expect(urgent.offerWave).toHaveLength(3);
  });

  it("keeps matching independent from payment activation", () => {
    expect(migration).toContain("'CONTRACTOR_SET'");
    expect(migration).toContain("'PRICE_THEN_UTILIZATION_THEN_PRIORITY'");
    expect(migration).toContain("paymentReadyCandidateCount");
    expect(migration).toContain("cc.status = 'APPROVED'");
    expect(migration).not.toContain("insert into domain.orders");
    expect(migration).not.toContain("insert into domain.order_offers");
    expect(matchRoute).not.toContain('PROVIDER_MODE === "real"');
    expect(quoteRoute).not.toContain("marketplace_match_preview");
  });

  it("shows dashboard and logout controls for authenticated users", () => {
    expect(header).toContain("HeaderAuthActions");
    expect(headerActions).toContain("Dashboard");
    expect(headerActions).toContain("Log out");
    expect(logout).toContain("client.auth.signOut()");
    expect(session).toContain('contractor.company_status === "APPROVED"');
    expect(session).toContain('"/contractor/onboarding"');
  });
});
