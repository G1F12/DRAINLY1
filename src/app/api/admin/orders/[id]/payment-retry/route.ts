import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  taskType: z.enum(["AUTHORIZE_PAYMENT", "CAPTURE_PAYMENT", "CANCEL_AUTHORIZATION", "CANCEL_ORDER_AUTHORIZATION"]),
  reason: z.string().trim().min(10).max(1000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const { id } = await params;
    const client = await createSupabaseServerClient();
    if (!client) return Response.json({ taskId: crypto.randomUUID(), status: "PENDING", demo: true });
    const { data, error } = await client.rpc("retry_failed_payment_operation", {
      p_order_id: id, p_task_type: body.taskType, p_reason: body.reason, p_idempotency_key: key,
    });
    if (error) return apiError("FORBIDDEN", error.message, 403);
    return Response.json(data);
  } catch (error) {
    return error instanceof z.ZodError
      ? apiError("BAD_REQUEST", "Invalid payment recovery request", 400, error.flatten())
      : apiError("INTERNAL_ERROR", "Payment recovery failed", 500);
  }
}
