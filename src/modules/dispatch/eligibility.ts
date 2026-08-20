export interface ContractorEligibilityInput {
  approved: boolean;
  enabled: boolean;
  servesRegion: boolean;
  hasPrice: boolean;
  worksRequestedDay: boolean;
  blackedOut: boolean;
  assignedJobs: number;
  maxJobs: number;
  urgentRequested: boolean;
  urgentEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  payoutFunded: boolean;
  contributionGuardrailMet: boolean;
}

export function contractorEligibility(input: ContractorEligibilityInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.approved) reasons.push("NOT_APPROVED");
  if (!input.enabled) reasons.push("DISABLED");
  if (!input.servesRegion) reasons.push("OUTSIDE_SERVICE_AREA");
  if (!input.hasPrice) reasons.push("MISSING_PRICE");
  if (!input.worksRequestedDay || input.blackedOut) reasons.push("UNAVAILABLE");
  if (input.assignedJobs >= input.maxJobs) reasons.push("CAPACITY_EXHAUSTED");
  if (input.urgentRequested && !input.urgentEnabled) reasons.push("URGENT_NOT_SUPPORTED");
  if (!input.stripeDetailsSubmitted || !input.stripeChargesEnabled || !input.stripePayoutsEnabled) reasons.push("CONNECT_NOT_READY");
  if (!input.payoutFunded) reasons.push("PAYOUT_NOT_FUNDED");
  if (!input.contributionGuardrailMet) reasons.push("CONTRIBUTION_GUARDRAIL_FAILED");
  return { eligible: reasons.length === 0, reasons };
}

export interface RankedContractor { id: string; priority: number; assignedJobs: number; maxJobs: number }

export function rankContractors(contractors: RankedContractor[]): RankedContractor[] {
  return [...contractors].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const utilization = a.assignedJobs / Math.max(a.maxJobs, 1) - b.assignedJobs / Math.max(b.maxJobs, 1);
    return utilization !== 0 ? utilization : a.id.localeCompare(b.id);
  });
}
