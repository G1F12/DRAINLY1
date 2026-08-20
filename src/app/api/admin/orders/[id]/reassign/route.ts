import { z } from "zod";
import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ replacementContractorCompanyId: z.uuid(), reason: z.string().trim().min(10).max(1000) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request); if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema); const { id } = await params; const client = await createSupabaseServerClient();
    if (!client) return Response.json({ reassignmentPending: true, demo: true });
    const { data, error } = await client.rpc("reassign_order", { p_order_id: id, p_replacement_contractor_company_id: body.replacementContractorCompanyId, p_reason: body.reason, p_idempotency_key: key });
    if (error) return apiError("CONFLICT", error.message, 409); return Response.json(data);
  } catch (error) { return error instanceof z.ZodError ? apiError("BAD_REQUEST", "Invalid reassignment", 400, error.flatten()) : apiError("INTERNAL_ERROR", "Reassignment failed", 500); }
}
