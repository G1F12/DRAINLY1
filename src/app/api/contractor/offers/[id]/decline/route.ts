import { apiError, getIdempotencyKey, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  const { id } = await params;
  const client = await createSupabaseServerClient();
  if (!client) return Response.json({ declined: true, demo: true });
  const { error } = await client.rpc("decline_order_offer", { p_offer_id: id, p_idempotency_key: key });
  if (error) return apiError("FORBIDDEN", error.message, 403);
  return Response.json({ declined: true });
}
