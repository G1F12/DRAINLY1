import { apiError, getIdempotencyKey, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  const { id } = await params;
  const providerMode = (process.env.PROVIDER_MODE ?? "fake").trim().toLowerCase();
  if (providerMode === "fake") return Response.json({ declined: true, demo: true });
  if (providerMode !== "real") return apiError("INTERNAL_ERROR", "Service provider mode is misconfigured", 500);
  const client = await createSupabaseServerClient();
  if (!client) return apiError("PROVIDER_UNAVAILABLE", "Contractor service is not configured", 503);
  const { error } = await client.rpc("decline_order_offer", { p_offer_id: id, p_idempotency_key: key });
  if (error) return apiError("FORBIDDEN", error.message, 403);
  return Response.json({ declined: true });
}
