import { apiError, getIdempotencyKey, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  const { id } = await params;
  const providerMode = (process.env.PROVIDER_MODE ?? "fake").trim().toLowerCase();
  if (providerMode === "fake") return Response.json({ assignmentId: crypto.randomUUID(), paymentGenerationId: crypto.randomUUID(), status: "SCHEDULED", demo: true });
  if (providerMode !== "real") return apiError("INTERNAL_ERROR", "Service provider mode is misconfigured", 500);
  const client = await createSupabaseServerClient();
  if (!client) return apiError("PROVIDER_UNAVAILABLE", "Contractor service is not configured", 503);
  const { data, error } = await client.rpc("accept_order_offer", { p_offer_id: id, p_idempotency_key: key });
  if (error) return apiError(error.message.includes("ALREADY_ASSIGNED") ? "CONFLICT" : "FORBIDDEN", error.message, error.message.includes("ALREADY_ASSIGNED") ? 409 : 403);
  return Response.json(data);
}
