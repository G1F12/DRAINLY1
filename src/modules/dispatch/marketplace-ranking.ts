export type MarketplaceTimingKind = "SCHEDULED" | "EARLIEST" | "URGENT";

export interface MarketplaceCandidate {
  id: string;
  contractorGrossCents: number;
  assignedJobs: number;
  maxJobs: number;
  priority: number;
  paymentReady: boolean;
}

export interface DispatchPlan {
  mode: "PLANNED_CONFIRMATION" | "URGENT_BROADCAST";
  ranked: MarketplaceCandidate[];
  offerWave: MarketplaceCandidate[];
}

export function utilization(candidate: Pick<MarketplaceCandidate, "assignedJobs" | "maxJobs">): number {
  return candidate.assignedJobs / Math.max(candidate.maxJobs, 1);
}

export function rankMarketplaceCandidates(candidates: MarketplaceCandidate[]): MarketplaceCandidate[] {
  return [...candidates]
    .filter((candidate) => candidate.maxJobs > 0 && candidate.assignedJobs < candidate.maxJobs)
    .sort((a, b) => {
      if (a.contractorGrossCents !== b.contractorGrossCents) {
        return a.contractorGrossCents - b.contractorGrossCents;
      }
      const utilizationDelta = utilization(a) - utilization(b);
      if (utilizationDelta !== 0) return utilizationDelta;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });
}

export function buildDispatchPlan(
  candidates: MarketplaceCandidate[],
  timingKind: MarketplaceTimingKind,
): DispatchPlan {
  const ranked = rankMarketplaceCandidates(candidates);
  const fanout = timingKind === "URGENT" ? 3 : 1;
  return {
    mode: timingKind === "URGENT" ? "URGENT_BROADCAST" : "PLANNED_CONFIRMATION",
    ranked,
    offerWave: ranked.slice(0, fanout),
  };
}
