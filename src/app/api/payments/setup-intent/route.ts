import { z } from "zod";

import { apiError, clientAddress, getIdempotencyKey, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumePaymentRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPaymentGateway } from "@/modules/payments/gateway";

const schema = z.object({ email: z.email() });

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);

  try {
    const body = await parseJson(request, schema);
    const user = await getCurrentUser();
    const realPayment = process.env.PAYMENT_PROVIDER_MODE === "stripe_test"
      || process.env.PROVIDER_MODE === "real";

    if (!user && realPayment) {
      return apiError("UNAUTHENTICATED", "Verified customer sign-in is required", 401);
    }
    if (user && user.email?.toLowerCase() !== body.email.toLowerCase()) {
      return apiError("FORBIDDEN", "Email does not match the authenticated customer", 403);
    }

    const address = clientAddress(request);
    const actor = user?.id ?? body.email.toLowerCase();
    const [actorAllowed, ipAllowed] = await Promise.all([
      consumePaymentRateLimit(hashRateLimitKey(`setup-intent:${actor}`), 20, 3600),
      consumePaymentRateLimit(hashRateLimitKey(`setup-intent-ip:${address}`), 60, 3600),
    ]);
    if (!actorAllowed || !ipAllowed) {
      return apiError("RATE_LIMITED", "Too many payment setup attempts", 429);
    }

    const result = await getPaymentGateway().createSetupIntent({
      email: body.email,
      idempotencyKey: key,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid setup request", 400);
    return apiError(
      "PROVIDER_UNAVAILABLE",
      error instanceof Error ? error.message : "Payment setup failed",
      503,
    );
  }
}