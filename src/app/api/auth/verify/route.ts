import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.email(), token: z.string().regex(/^\d{6}$/), phone: z.string().trim().max(30).optional() });

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  if (!getIdempotencyKey(request)) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const client = await createSupabaseServerClient();
    if (!client) return Response.json({ verified: body.token === "123456", demo: true }, { status: body.token === "123456" ? 200 : 400 });
    const { error } = await client.auth.verifyOtp({ email: body.email, token: body.token, type: "email" });
    if (error) return apiError("UNAUTHENTICATED", "The code is invalid or expired", 401);
    const { error: profileError } = await client.rpc("ensure_customer_profile", { p_phone: body.phone });
    if (profileError) return apiError("INTERNAL_ERROR", "Customer profile could not be prepared", 500);
    return Response.json({ verified: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid verification request", 400);
    return apiError("INTERNAL_ERROR", "Verification failed", 500);
  }
}
