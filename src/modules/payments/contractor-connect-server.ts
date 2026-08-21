import "server-only";

import { getServerEnv } from "@/lib/env";
import { getPaymentSystemDb } from "@/lib/system-db";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  createSandboxRecipientAccount,
  createSandboxRecipientOnboardingLink,
  retrieveSandboxRecipientAccount,
} from "@/modules/payments/connect-sandbox";

export interface ContractorConnectContext {
  exists: boolean;
  companyId?: string;
  displayName?: string;
  email?: string;
  status?: string;
  stripeAccountId?: string | null;
  connectEnvironment?: "UNCONNECTED" | "SANDBOX";
  transferCapabilityStatus?: string | null;
  connectReady?: boolean;
  syncedAt?: string | null;
}

export async function authenticatedContractorConnectContext(): Promise<{
  user: { id: string; email?: string | null } | null;
  context: ContractorConnectContext | null;
}> {
  const user = await getCurrentUser();
  if (!user) return { user: null, context: null };
  const sql = getPaymentSystemDb();
  if (!sql) throw new Error("SYSTEM_DATABASE_UNAVAILABLE");
  const rows = await sql<{ context: ContractorConnectContext }[]>`
    select internal.get_contractor_connect_context(${user.id}::uuid) as context
  `;
  return { user, context: rows[0]?.context ?? null };
}

export async function syncContractorConnectStatus(input: {
  authUserId: string;
  accountId: string;
}) {
  const sql = getPaymentSystemDb();
  if (!sql) throw new Error("SYSTEM_DATABASE_UNAVAILABLE");
  const status = await retrieveSandboxRecipientAccount(input.accountId);
  await sql`
    select internal.record_contractor_connect_status(
      ${input.authUserId}::uuid,
      ${status.accountId},
      ${status.transferCapabilityStatus}
    )
  `;
  return status;
}

export async function ensureContractorSandboxAccount(input: {
  authUserId: string;
  email: string;
  context: ContractorConnectContext;
  idempotencyKey: string;
}): Promise<{ accountId: string; transferCapabilityStatus: string }> {
  if (!input.context.exists || !input.context.companyId || !input.context.displayName) {
    throw new Error("CONTRACTOR_PROFILE_REQUIRED");
  }

  if (input.context.stripeAccountId) {
    const synced = await syncContractorConnectStatus({ authUserId: input.authUserId, accountId: input.context.stripeAccountId });
    return { accountId: synced.accountId, transferCapabilityStatus: synced.transferCapabilityStatus };
  }

  const created = await createSandboxRecipientAccount({
    email: input.email,
    displayName: input.context.displayName,
    idempotencyKey: `connect-account:${input.idempotencyKey}`,
  });

  const sql = getPaymentSystemDb();
  if (!sql) throw new Error("SYSTEM_DATABASE_UNAVAILABLE");
  await sql`
    select internal.bind_contractor_connect_account(
      ${input.authUserId}::uuid,
      ${created.accountId}
    )
  `;
  await sql`
    select internal.record_contractor_connect_status(
      ${input.authUserId}::uuid,
      ${created.accountId},
      ${created.transferCapabilityStatus}
    )
  `;
  return created;
}

export async function contractorSandboxOnboardingUrl(input: {
  accountId: string;
  idempotencyKey: string;
}) {
  const env = getServerEnv();
  const base = new URL(env.APP_BASE_URL);
  if (base.protocol !== "https:") throw new Error("CONNECT_APP_BASE_URL_MUST_BE_HTTPS");
  const returnUrl = new URL("/contractor/onboarding?connect=returned", base).toString();
  const refreshUrl = new URL("/api/contractor/connect/refresh", base).toString();
  return createSandboxRecipientOnboardingLink({
    accountId: input.accountId,
    refreshUrl,
    returnUrl,
    idempotencyKey: `connect-link:${input.idempotencyKey}`,
  });
}
