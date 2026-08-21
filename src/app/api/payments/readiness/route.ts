import { getAdminContext } from "@/lib/admin-auth";
import { getServerEnv } from "@/lib/env";

export async function GET() {
  const env = getServerEnv();
  const stripeTestConfigured = env.PAYMENT_PROVIDER_MODE === "stripe_test"
    && Boolean(env.STRIPE_SECRET_KEY)
    && Boolean(env.STRIPE_WEBHOOK_SECRET);
  const stripeTestUiConfigured = stripeTestConfigured
    && Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_"));

  const admin = await getAdminContext();
  if (!admin.isAdmin) {
    return Response.json({
      paymentSetupAvailable: stripeTestUiConfigured,
      liveChargesAllowed: false,
    }, { headers: { "cache-control": "no-store" } });
  }

  return Response.json({
    paymentProviderMode: env.PAYMENT_PROVIDER_MODE,
    stripeTestConfigured,
    stripeTestUiConfigured,
    coreMarketplaceReal: env.PROVIDER_MODE === "real",
    authReal: env.AUTH_PROVIDER_MODE === "real",
    livePilotEnabled: false,
    liveChargesAllowed: false,
    nextGate: stripeTestUiConfigured
      ? "TEST_PAYMENT_FLOW"
      : stripeTestConfigured
        ? "CONFIGURE_STRIPE_TEST_PUBLISHABLE_KEY"
        : "CONFIGURE_STRIPE_TEST_KEYS",
  }, { headers: { "cache-control": "no-store" } });
}