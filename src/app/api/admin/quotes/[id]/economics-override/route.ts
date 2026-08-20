import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ minimumContributionMarginCents: z.number().int().min(-100_000).max(1_000_000), reason: z.string().trim().min(10).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const { id } = await params;
    const client = await createSupabaseServerClient();
    if (!client) return Response.json({ quoteId: id, status: "PRICED", demo: true });
    const { data, error } = await client.rpc("admin_override_quote_economics", {
      p_quote_id: id,
      p_minimum_contribution_margin_cents: body.minimumContributionMarginCents,
      p_reason: body.reason,
      p_idempotency_key: key,
    });
    if (error) return apiError("CONFLICT", error.message, 409);
    return Response.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid economics override", 400, error.flatten());
    return apiError("INTERNAL_ERROR", "Economics override failed", 500);
  }
}
