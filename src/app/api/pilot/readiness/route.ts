import { getSandboxPilotGate } from "@/lib/pilot-gate";
import { getPaymentSystemDb } from "@/lib/system-db";
import { getCurrentUser } from "@/lib/supabase/server";

type DatabasePilotReadiness = {
  bookingExecutionEnabled?: boolean;
  paymentExecutionEnabled?: boolean;
  allowedPaymentMode?: string;
  maxCustomerTotalCents?: number;
  contractorCount?: number;
  approvedContractorCount?: number;
  verificationReadyContractorCount?: number;
  dispatchReadyContractorCount?: number;
  paymentReadyContractorCount?: number;
  activeServiceRegionCount?: number;
  activeRegionalPriceRuleCount?: number;
  marketplaceSettingsConfigured?: boolean;
  readyForDispatchDryRun?: boolean;
  readyForTestPayments?: boolean;
};

export async function GET() {
  const user = await getCurrentUser();
  const gate = getSandboxPilotGate(user?.email);
  let database: DatabasePilotReadiness | null = null;

  const sql = getPaymentSystemDb();
  if (sql) {
    try {
      const rows = await sql<{ readiness: DatabasePilotReadiness }[]>`select api.pilot_readiness() as readiness`;
      database = rows[0]?.readiness ?? null;
    } catch {
      database = null;
    }
  }

  const databaseExecutionOpen = database?.bookingExecutionEnabled === true
    && database?.paymentExecutionEnabled === true
    && database?.allowedPaymentMode === "STRIPE_TEST"
    && database?.readyForTestPayments === true;

  return Response.json({
    pilotMode: gate.pilotMode,
    signedIn: Boolean(user),
    coreMarketplaceReal: gate.coreMarketplaceReal,
    authReal: gate.authReal,
    stripeTestPayments: gate.stripeTestPayments,
    allowlistConfigured: gate.allowlistConfigured,
    callerAllowlisted: gate.callerAllowlisted,
    infrastructureReady: gate.infrastructureReady,
    bookingAllowed: gate.bookingAllowed && databaseExecutionOpen,
    databaseExecutionOpen,
    database,
    liveChargesAllowed: false,
    blockers: gate.blockers,
    nextGate: gate.bookingAllowed && databaseExecutionOpen
      ? "SANDBOX_PILOT_BOOKING"
      : gate.infrastructureReady
        ? "DATABASE_PILOT_GATE_OR_SUPPLY_NOT_READY"
        : "PILOT_REMAINS_CLOSED",
  }, { headers: { "cache-control": "no-store" } });
}
