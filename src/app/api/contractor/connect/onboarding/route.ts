import { apiError, getIdempotencyKey, hashRateLimitKey, requireSameOrigin } from "@/lib/http";
import { consumePaymentRateLimit } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/env";
import {
  authenticatedContractorConnectContext,
  contractorSandboxOnboardingUrl,
  ensureContractorSandboxAccount,
} from "@/modules/payments/contractor-connect-server";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  if (getServerEnv().PAYMENT_PROVIDER_MODE !== "stripe_test") {
    return apiError("PROVIDER_UNAVAILABLE", "Stripe Connect sandbox is not enabled.", 503);
  }

  try {
    const { user, context } = await authenticatedContractorConnectContext();
    if (!user?.email) return apiError("UNAUTHENTICATED", "Sign in with a verified email to continue.", 401);
    if (!context?.exists) return apiError("CONFLICT", "Save your contractor profile before payout onboarding.", 409);
    if (!(await consumePaymentRateLimit(hashRateLimitKey(`contractor-connect-onboarding:${user.id}`), 10, 3600))) {
      return apiError("RATE_LIMITED", "Too many payout onboarding attempts. Try again later.", 429);
    }

    const account = await ensureContractorSandboxAccount({
      authUserId: user.id,
      email: user.email,
      context,
      idempotencyKey,
    });
    const url = await contractorSandboxOnboardingUrl({ accountId: account.accountId, idempotencyKey });
    return Response.json({ url, sandboxOnly: true, livePayoutsEnabled: false }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("CONTRACTOR_OWNER_REQUIRED")) return apiError("FORBIDDEN", "Only the contractor owner can manage payout onboarding.", 403);
    if (message.includes("STRIPE_CONNECT_REQUEST_FAILED")) return apiError("CONFLICT", "Stripe Connect sandbox onboarding is not ready for this account yet.", 409);
    return apiError("INTERNAL_ERROR", "Contractor payout onboarding could not be started.", 500);
  }
}
