import { getServerEnv } from "@/lib/env";

export async function GET() {
  const env = getServerEnv();
  const stripeTestConfigured =
    env.PAYMENT_PROVIDER_MODE === "stripe_test"
    && Boolean(env.STRIPE_SECRET_KEY)
    && Boolean(env.STRIPE_WEBHOOK_SECRET);

  return Response.json(
    {
      paymentProviderMode: env.PAYMENT_PROVIDER_MODE,
      stripeTestConfigured,
      coreMarketplaceReal: env.PROVIDER_MODE === "real",
      authReal: env.AUTH_PROVIDER_MODE === "real",
      livePilotEnabled: false,
      liveChargesAllowed: false,
      nextGate: stripeTestConfigured
        ? "TEST_PAYMENT_FLOW"
        : "CONFIGURE_STRIPE_TEST_KEYS",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
