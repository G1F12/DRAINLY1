import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ reason: z.string().trim().min(5).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const { id } = await params;
    const client = await createSupabaseServerClient();
    if (!client) return Response.json({ orderId: id, status: "CANCELLED", demo: true });
    const { data, error } = await client.rpc("cancel_order", { p_order_id: id, p_reason: body.reason, p_idempotency_key: key });
    if (error) return apiError("CONFLICT", error.message, 409);
    return Response.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid cancellation", 400, error.flatten());
    return apiError("INTERNAL_ERROR", "Cancellation failed", 500);
  }
}
