import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gateway = readFileSync("src/modules/payments/connect-sandbox.ts", "utf8");
const server = readFileSync("src/modules/payments/contractor-connect-server.ts", "utf8");
const onboarding = readFileSync("src/app/api/contractor/connect/onboarding/route.ts", "utf8");
const refresh = readFileSync("src/app/api/contractor/connect/refresh/route.ts", "utf8");
const status = readFileSync("src/app/api/contractor/connect/status/route.ts", "utf8");
const panel = readFileSync("src/components/contractor-connect-sandbox-panel.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260821124327_stage5e_connect_sandbox_foundation.sql", "utf8");

describe("stage 5E Stripe Connect sandbox onboarding", () => {
  it("creates recipient-only Accounts v2 with platform fee/loss responsibility", () => {
    expect(gateway).toContain('"/v2/core/accounts"');
    expect(gateway).toContain('fees_collector: "application"');
    expect(gateway).toContain('losses_collector: "application"');
    expect(gateway).toContain('dashboard: "express"');
    expect(gateway).toContain('recipient:');
    expect(gateway).toContain('stripe_transfers: { requested: true }');
    expect(gateway).not.toContain('card_payments');
  });

  it("accepts only Stripe test secrets and uses Stripe-hosted recipient onboarding", () => {
    expect(gateway).toContain('startsWith("sk_test_")');
    expect(gateway).toContain('"/v2/core/account_links"');
    expect(gateway).toContain('type: "account_onboarding"');
    expect(gateway).toContain('configurations: ["recipient"]');
    expect(gateway).toContain('fields: "eventually_due"');
    expect(gateway).not.toContain("sk_live_");
  });

  it("binds connected accounts only through the trusted system database path", () => {
    expect(server).toContain("internal.get_contractor_connect_context");
    expect(server).toContain("internal.bind_contractor_connect_account");
    expect(server).toContain("internal.record_contractor_connect_status");
    expect(migration).toContain("CONTRACTOR_OWNER_REQUIRED");
    expect(migration).toContain("grant execute on function internal.bind_contractor_connect_account(uuid, text) to drainly_system");
    expect(migration).toContain("revoke all on function internal.bind_contractor_connect_account(uuid, text) from public, anon, authenticated");
  });

  it("never reports or enables live payouts from the sandbox routes or UI", () => {
    expect(onboarding).toContain("livePayoutsEnabled: false");
    expect(status).toContain("livePayoutsEnabled: false");
    expect(panel).toContain("Live payouts enabled: no.");
    expect(panel).toContain("Sandbox only");
  });

  it("uses an authenticated refresh route to mint a fresh single-use onboarding link", () => {
    expect(refresh).toContain("authenticatedContractorConnectContext");
    expect(refresh).toContain("crypto.randomUUID()");
    expect(refresh).toContain("Response.redirect(url, 303)");
  });
});
