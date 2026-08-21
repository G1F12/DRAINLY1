import { z } from "zod";

import { allowDemoFallback } from "@/lib/demo-boundary";
import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(5).max(1000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);

  try {
    const body = await parseJson(request, schema);
    const { id } = await params;
    const client = await createSupabaseServerClient();
    if (!client) {
      if (allowDemoFallback()) {
        return Response.json({ refundId: crypto.randomUUID(), status: "REQUESTED", demo: true });
      }
      return apiError("PROVIDER_UNAVAILABLE", "Controlled admin actions are not enabled", 503);
    }

    const { data, error } = await client.rpc("request_refund", {
      p_order_id: id,
      p_amount_cents: body.amountCents,
      p_reason: body.reason,
      p_idempotency_key: key,
    });
    if (error) return apiError("CONFLICT", error.message, 409);
    return Response.json(data);
  } catch (error) {
    return error instanceof z.ZodError
      ? apiError("BAD_REQUEST", "Invalid refund", 400)
      : apiError("INTERNAL_ERROR", "Refund failed", 500);
  }
}