import { apiError, getIdempotencyKey, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  const { id } = await params;
  const client = await createSupabaseServerClient();
  if (!client) return Response.json({ assignmentId: crypto.randomUUID(), paymentGenerationId: crypto.randomUUID(), status: "SCHEDULED", demo: true });
  const { data, error } = await client.rpc("accept_order_offer", { p_offer_id: id, p_idempotency_key: key });
  if (error) return apiError(error.message.includes("ALREADY_ASSIGNED") ? "CONFLICT" : "FORBIDDEN", error.message, error.message.includes("ALREADY_ASSIGNED") ? 409 : 403);
  return Response.json(data);
}
