import { describe, expect, it } from "vitest";
import { transitionContractorJob } from "@/modules/orders/state-machine";

const base = { orderStatus: "SCHEDULED" as const, paymentStatus: "AUTHORIZED" as const, authorizationOverride: false, accessType: "ATTENDED" as const, hasVerifiedProof: false };
describe("order state machine", () => {
  it("progresses only through the valid service sequence", () => {
    expect(transitionContractorJob("MARK_EN_ROUTE", base)).toBe("EN_ROUTE");
    expect(transitionContractorJob("MARK_ARRIVED", { ...base, orderStatus: "EN_ROUTE" })).toBe("ARRIVED");
    expect(transitionContractorJob("COMPLETE", { ...base, orderStatus: "ARRIVED" })).toBe("SERVICE_COMPLETED");
  });
  it("blocks route start without current authorization", () => { expect(() => transitionContractorJob("MARK_EN_ROUTE", { ...base, paymentStatus: "ACTION_REQUIRED" })).toThrow("PAYMENT_AUTHORIZATION_REQUIRED"); });
  it("allows only the dedicated override to bypass authorization", () => { expect(transitionContractorJob("MARK_EN_ROUTE", { ...base, paymentStatus: "FAILED", authorizationOverride: true })).toBe("EN_ROUTE"); });
  it("requires proof for unattended completion", () => { expect(() => transitionContractorJob("COMPLETE", { ...base, orderStatus: "ARRIVED", accessType: "UNATTENDED" })).toThrow("VERIFIED_PROOF_REQUIRED"); expect(transitionContractorJob("COMPLETE", { ...base, orderStatus: "ARRIVED", accessType: "UNATTENDED", hasVerifiedProof: true })).toBe("SERVICE_COMPLETED"); });
  it("requires explicit failure reasons", () => { expect(() => transitionContractorJob("FAIL_ACCESS", base)).toThrow("FAILURE_REASON_REQUIRED"); expect(transitionContractorJob("FAIL_ACCESS", { ...base, reason: "Locked gate" })).toBe("FAILED_ACCESS"); });
  it("rejects illegal transitions", () => { expect(() => transitionContractorJob("MARK_ARRIVED", base)).toThrow("ILLEGAL_TRANSITION"); });
});
