import "server-only";

import { getServerEnv } from "@/lib/env";

const STRIPE_API_BASE = "https://api.stripe.com";
const STRIPE_V2_VERSION = "2026-07-29.preview";

type JsonRecord = Record<string, unknown>;

interface StripeRecipientAccountResponse {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: {
            status?: string;
          };
        };
      };
    };
  };
}

interface StripeAccountLinkResponse {
  url: string;
}

function stripeTestSecret(): string {
  const env = getServerEnv();
  if (env.PAYMENT_PROVIDER_MODE !== "stripe_test" || !env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("STRIPE_CONNECT_SANDBOX_DISABLED");
  }
  return env.STRIPE_SECRET_KEY;
}

async function stripeV2<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: JsonRecord; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${stripeTestSecret()}`,
    "stripe-version": STRIPE_V2_VERSION,
  };
  if (init.body) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  const payload = await response.json() as JsonRecord;
  if (!response.ok) {
    const requestId = response.headers.get("request-id") ?? "unknown";
    throw new Error(`STRIPE_CONNECT_REQUEST_FAILED:${response.status}:${requestId}`);
  }
  return payload as T;
}

export async function createSandboxRecipientAccount(input: {
  email: string;
  displayName: string;
  idempotencyKey: string;
}): Promise<{ accountId: string; transferCapabilityStatus: string }> {
  const account = await stripeV2<StripeRecipientAccountResponse>("/v2/core/accounts", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      contact_email: input.email,
      display_name: input.displayName,
      defaults: {
        responsibilities: {
          fees_collector: "application",
          losses_collector: "application",
        },
      },
      dashboard: "express",
      identity: { country: "us" },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
      },
      include: ["configuration.recipient", "identity", "requirements"],
    },
  });

  if (!/^acct_[A-Za-z0-9]+$/.test(account.id)) throw new Error("STRIPE_CONNECT_ACCOUNT_ID_INVALID");
  return {
    accountId: account.id,
    transferCapabilityStatus: transferStatus(account),
  };
}

export async function retrieveSandboxRecipientAccount(accountId: string): Promise<{
  accountId: string;
  transferCapabilityStatus: string;
  connectReady: boolean;
}> {
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("STRIPE_CONNECT_ACCOUNT_ID_INVALID");
  const query = new URLSearchParams();
  query.append("include[]", "configuration.recipient");
  query.append("include[]", "requirements");
  const account = await stripeV2<StripeRecipientAccountResponse>(
    `/v2/core/accounts/${encodeURIComponent(accountId)}?${query.toString()}`,
  );
  const status = transferStatus(account);
  return { accountId: account.id, transferCapabilityStatus: status, connectReady: status === "active" };
}

export async function createSandboxRecipientOnboardingLink(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  idempotencyKey: string;
}): Promise<string> {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.accountId)) throw new Error("STRIPE_CONNECT_ACCOUNT_ID_INVALID");
  for (const url of [input.refreshUrl, input.returnUrl]) {
    if (!url.startsWith("https://")) throw new Error("STRIPE_CONNECT_HTTPS_REDIRECT_REQUIRED");
  }

  const link = await stripeV2<StripeAccountLinkResponse>("/v2/core/account_links", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {
      account: input.accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient"],
          collection_options: { fields: "eventually_due" },
          refresh_url: input.refreshUrl,
          return_url: input.returnUrl,
        },
      },
    },
  });

  if (!link.url?.startsWith("https://")) throw new Error("STRIPE_CONNECT_LINK_MISSING");
  return link.url;
}

function transferStatus(account: StripeRecipientAccountResponse): string {
  return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? "unknown";
}
