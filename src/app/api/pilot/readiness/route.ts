import { getSandboxPilotGate } from "@/lib/pilot-gate";
import { getCurrentUser } from "@/lib/supabase/server";

export async function GET() {
  const user = await getCurrentUser();
  const gate = getSandboxPilotGate(user?.email);

  return Response.json(
    {
      pilotMode: gate.pilotMode,
      signedIn: Boolean(user),
      coreMarketplaceReal: gate.coreMarketplaceReal,
      authReal: gate.authReal,
      stripeTestPayments: gate.stripeTestPayments,
      allowlistConfigured: gate.allowlistConfigured,
      callerAllowlisted: gate.callerAllowlisted,
      infrastructureReady: gate.infrastructureReady,
      bookingAllowed: gate.bookingAllowed,
      liveChargesAllowed: false,
      blockers: gate.blockers,
      nextGate: gate.bookingAllowed
        ? "SANDBOX_PILOT_BOOKING"
        : gate.infrastructureReady
          ? "ALLOWLIST_CUSTOMER"
          : "PILOT_REMAINS_CLOSED",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
