import { z } from "zod";

import { allowDemoFallback } from "@/lib/demo-boundary";
import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  contractorCompanyId: z.uuid(),
  reason: z.string().trim().min(10).max(1000),
});
const idSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);

  try {
    const body = await parseJson(request, bodySchema);
    const id = idSchema.parse((await params).id);
    const client = await createSupabaseServerClient();
    if (!client) {
      if (allowDemoFallback()) return Response.json({ assignmentPending: true, demo: true });
      return apiError("PROVIDER_UNAVAILABLE", "Controlled admin actions are not enabled", 503);
    }

    const { data, error } = await client.rpc("reassign_order", {
      p_order_id: id,
      p_replacement_contractor_company_id: body.contractorCompanyId,
      p_reason: body.reason,
      p_idempotency_key: key,
    });
    if (error) return apiError("CONFLICT", error.message, 409);
    return Response.json(data);
  } catch (error) {
    return error instanceof z.ZodError
      ? apiError("BAD_REQUEST", "Invalid assignment", 400)
      : apiError("INTERNAL_ERROR", "Assignment failed", 500);
  }
}