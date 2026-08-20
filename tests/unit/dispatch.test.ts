import { describe, expect, it } from "vitest";
import { contractorEligibility, rankContractors } from "@/modules/dispatch/eligibility";

const eligible = { approved: true, enabled: true, servesRegion: true, hasPrice: true, worksRequestedDay: true, blackedOut: false, assignedJobs: 1, maxJobs: 3, urgentRequested: false, urgentEnabled: false, stripeDetailsSubmitted: true, stripeChargesEnabled: true, stripePayoutsEnabled: true, payoutFunded: true, contributionGuardrailMet: true };
describe("dispatch", () => {
  it("requires every eligibility boundary", () => { expect(contractorEligibility(eligible)).toEqual({ eligible: true, reasons: [] }); expect(contractorEligibility({ ...eligible, approved: false, payoutFunded: false })).toEqual({ eligible: false, reasons: ["NOT_APPROVED", "PAYOUT_NOT_FUNDED"] }); });
  it("enforces capacity and urgent support", () => { expect(contractorEligibility({ ...eligible, assignedJobs: 3, urgentRequested: true })).toEqual({ eligible: false, reasons: ["CAPACITY_EXHAUSTED", "URGENT_NOT_SUPPORTED"] }); });
  it("ranks deterministically by priority, utilization, then id", () => { expect(rankContractors([{ id: "b", priority: 10, assignedJobs: 1, maxJobs: 2 }, { id: "a", priority: 10, assignedJobs: 0, maxJobs: 2 }, { id: "z", priority: 20, assignedJobs: 0, maxJobs: 3 }]).map((item) => item.id)).toEqual(["a", "b", "z"]); });
});
