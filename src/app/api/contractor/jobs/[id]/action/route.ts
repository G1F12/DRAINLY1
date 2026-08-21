import { z } from "zod";
import { getServerEnv } from "@/lib/env";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scheduleNotificationDrain } from "@/modules/notifications/dispatch";

const schema = z.object({ action: z.enum(["MARK_EN_ROUTE", "MARK_ARRIVED", "COMPLETE", "FAIL_ACCESS", "FAIL_SERVICE"]), reason: z.string().trim().max(1000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const { id } = await params;
    const env = getServerEnv();
    const providerMode = env.PROVIDER_MODE;
    if (providerMode === "fake") {
      if (env.AUTH_PROVIDER_MODE === "real") return apiError("PROVIDER_UNAVAILABLE", "Controlled contractor pilot actions are not enabled", 503);
      return Response.json({ orderId: id, status: body.action === "MARK_EN_ROUTE" ? "EN_ROUTE" : body.action === "MARK_ARRIVED" ? "ARRIVED" : body.action === "COMPLETE" ? "SERVICE_COMPLETED" : body.action === "FAIL_ACCESS" ? "FAILED_ACCESS" : "FAILED_SERVICE", demo: true });
    }
    if (providerMode !== "real") return apiError("INTERNAL_ERROR", "Service provider mode is misconfigured", 500);
    const client = await createSupabaseServerClient();
    if (!client) return apiError("PROVIDER_UNAVAILABLE", "Contractor service is not configured", 503);
    const { data, error } = await client.rpc("transition_job", { p_order_id: id, p_action: body.action, p_reason: body.reason ?? "", p_idempotency_key: key });
    if (error) return apiError("CONFLICT", error.message, 409);
    scheduleNotificationDrain();
    return Response.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid job action", 400, error.flatten());
    return apiError("INTERNAL_ERROR", "Job action failed", 500);
  }
}
