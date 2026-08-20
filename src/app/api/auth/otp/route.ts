import { z } from "zod";

import { apiError, clientAddress, getIdempotencyKey, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sendEmailOtp } from "@/lib/supabase/auth";

const schema = z.object({ email: z.email() });

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  if (!getIdempotencyKey(request)) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const key = hashRateLimitKey(`otp:${clientAddress(request)}:${body.email.toLowerCase()}`);
    if (!(await consumeRateLimit(key, 5, 3600))) return apiError("RATE_LIMITED", "Too many sign-in attempts", 429);
    const result = await sendEmailOtp(body.email);
    if (!result.enabled) return Response.json({ sent: true, demoCode: "123456", demo: true });
    if (result.error) return apiError("PROVIDER_UNAVAILABLE", "Unable to send sign-in code", 503);
    return Response.json({ sent: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Enter a valid email", 400);
    return apiError("INTERNAL_ERROR", "Sign-in request failed", 500);
  }
}
