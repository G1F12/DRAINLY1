import { apiError, hashRateLimitKey } from "@/lib/http";
import { consumePaymentRateLimit } from "@/lib/rate-limit";
import { getServerEnv } from "@/lib/env";
import {
  authenticatedContractorConnectContext,
  syncContractorConnectStatus,
} from "@/modules/payments/contractor-connect-server";

export async function GET() {
  if (getServerEnv().PAYMENT_PROVIDER_MODE !== "stripe_test") {
    return apiError("PROVIDER_UNAVAILABLE", "Stripe Connect sandbox is not enabled.", 503);
  }

  try {
    const { user, context } = await authenticatedContractorConnectContext();
    if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage contractor payout onboarding.", 401);
    if (!(await consumePaymentRateLimit(hashRateLimitKey(`contractor-connect-status:${user.id}`), 60, 3600))) {
      return apiError("RATE_LIMITED", "Too many payout status checks. Try again later.", 429);
    }
    if (!context?.exists) {
      return Response.json({ profileRequired: true, connected: false, sandboxOnly: true, livePayoutsEnabled: false });
    }

    let transferCapabilityStatus = context.transferCapabilityStatus ?? "not_started";
    let connectReady = Boolean(context.connectReady);
    let syncedAt = context.syncedAt ?? null;
    if (context.stripeAccountId) {
      const synced = await syncContractorConnectStatus({ authUserId: user.id, accountId: context.stripeAccountId });
      transferCapabilityStatus = synced.transferCapabilityStatus;
      connectReady = synced.connectReady;
      syncedAt = new Date().toISOString();
    }

    return Response.json({
      profileRequired: false,
      connected: Boolean(context.stripeAccountId),
      sandboxOnly: true,
      livePayoutsEnabled: false,
      transferCapabilityStatus,
      connectReady,
      syncedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return apiError("INTERNAL_ERROR", "Contractor payout status is temporarily unavailable.", 500);
  }
}
