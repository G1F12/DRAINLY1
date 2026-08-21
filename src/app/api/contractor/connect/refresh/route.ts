import { getServerEnv } from "@/lib/env";
import {
  authenticatedContractorConnectContext,
  contractorSandboxOnboardingUrl,
} from "@/modules/payments/contractor-connect-server";

export async function GET() {
  const env = getServerEnv();
  const base = new URL(env.APP_BASE_URL);
  const fallback = new URL("/contractor/onboarding?connect=refresh_failed", base);
  const signIn = new URL("/sign-in?next=%2Fcontractor%2Fonboarding", base);

  if (env.PAYMENT_PROVIDER_MODE !== "stripe_test") return Response.redirect(fallback, 303);

  try {
    const { user, context } = await authenticatedContractorConnectContext();
    if (!user) return Response.redirect(signIn, 303);
    if (!context?.stripeAccountId) return Response.redirect(fallback, 303);
    const url = await contractorSandboxOnboardingUrl({
      accountId: context.stripeAccountId,
      idempotencyKey: crypto.randomUUID(),
    });
    return Response.redirect(url, 303);
  } catch {
    return Response.redirect(fallback, 303);
  }
}
