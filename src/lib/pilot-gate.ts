import "server-only";

import { getServerEnv } from "@/lib/env";

export type PilotBlocker =
  | "PILOT_MODE_OFF"
  | "CORE_PROVIDER_NOT_REAL"
  | "AUTH_NOT_REAL"
  | "PAYMENT_NOT_STRIPE_TEST"
  | "CUSTOMER_ALLOWLIST_EMPTY"
  | "CUSTOMER_NOT_ALLOWLISTED";

export interface SandboxPilotGate {
  pilotMode: "off" | "sandbox";
  coreMarketplaceReal: boolean;
  authReal: boolean;
  stripeTestPayments: boolean;
  allowlistConfigured: boolean;
  callerAllowlisted: boolean;
  infrastructureReady: boolean;
  bookingAllowed: boolean;
  liveChargesAllowed: false;
  blockers: PilotBlocker[];
}

function allowedEmails(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getSandboxPilotGate(email?: string | null): SandboxPilotGate {
  const env = getServerEnv();
  const allowlist = allowedEmails(env.PILOT_ALLOWED_EMAILS);
  const normalizedEmail = email?.trim().toLowerCase() ?? "";

  const infrastructureBlockers: PilotBlocker[] = [];
  if (env.PILOT_MODE !== "sandbox") infrastructureBlockers.push("PILOT_MODE_OFF");
  if (env.PROVIDER_MODE !== "real") infrastructureBlockers.push("CORE_PROVIDER_NOT_REAL");
  if (env.AUTH_PROVIDER_MODE !== "real") infrastructureBlockers.push("AUTH_NOT_REAL");
  if (env.PAYMENT_PROVIDER_MODE !== "stripe_test") infrastructureBlockers.push("PAYMENT_NOT_STRIPE_TEST");
  if (allowlist.size === 0) infrastructureBlockers.push("CUSTOMER_ALLOWLIST_EMPTY");

  const infrastructureReady = infrastructureBlockers.length === 0;
  const callerAllowlisted = normalizedEmail.length > 0 && allowlist.has(normalizedEmail);
  const blockers = [...infrastructureBlockers];

  if (normalizedEmail && !callerAllowlisted) blockers.push("CUSTOMER_NOT_ALLOWLISTED");

  return {
    pilotMode: env.PILOT_MODE,
    coreMarketplaceReal: env.PROVIDER_MODE === "real",
    authReal: env.AUTH_PROVIDER_MODE === "real",
    stripeTestPayments: env.PAYMENT_PROVIDER_MODE === "stripe_test",
    allowlistConfigured: allowlist.size > 0,
    callerAllowlisted,
    infrastructureReady,
    bookingAllowed: infrastructureReady && callerAllowlisted,
    liveChargesAllowed: false,
    blockers,
  };
}

export function assertSandboxPilotMoneyMovementAllowed(operation: "AUTHORIZE" | "CAPTURE"): void {
  const gate = getSandboxPilotGate();
  if (!gate.infrastructureReady) {
    throw new Error(`PILOT_GATE_CLOSED:${operation}:${gate.blockers.join(",")}`);
  }
}
