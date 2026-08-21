import { z } from "zod";

import { allowDemoFallback } from "@/lib/demo-boundary";
import { apiError, clientAddress, getIdempotencyKey, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { verifyEmailOtp } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";

const schema = z.object({
  email: z.email(),
  token: z.string().regex(/^\d{6}$/),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  if (!getIdempotencyKey(request)) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);

  try {
    const body = await parseJson(request, schema);
    const address = clientAddress(request);
    const email = body.email.toLowerCase();

    const [pairAllowed, ipAllowed] = await Promise.all([
      consumeRateLimit(hashRateLimitKey(`otp-verify:${address}:${email}`), 10, 900),
      consumeRateLimit(hashRateLimitKey(`otp-verify-ip:${address}`), 60, 3600),
    ]);
    if (!pairAllowed || !ipAllowed) {
      return apiError("RATE_LIMITED", "Too many verification attempts", 429);
    }

    const authResult = await verifyEmailOtp(body.email, body.token);
    if (!authResult.enabled) {
      if (!allowDemoFallback()) {
        return apiError("PROVIDER_UNAVAILABLE", "Real sign-in is not configured", 503);
      }
      return Response.json(
        { verified: body.token === "123456", demo: true },
        { status: body.token === "123456" ? 200 : 400 },
      );
    }

    if (authResult.error || !authResult.user) {
      return apiError("UNAUTHENTICATED", "The code is invalid or expired", 401);
    }

    if (getServerEnv().PROVIDER_MODE === "real") {
      const client = await createSupabaseServerClient();
      if (!client) return apiError("PROVIDER_UNAVAILABLE", "Customer profile service is not configured", 503);
      const { error: profileError } = await client.rpc("ensure_customer_profile", { p_phone: body.phone });
      if (profileError) return apiError("INTERNAL_ERROR", "Customer profile could not be prepared", 500);
    }

    return Response.json({ verified: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid verification request", 400);
    return apiError("INTERNAL_ERROR", "Verification failed", 500);
  }
}