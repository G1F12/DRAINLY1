import { z } from "zod";

import { apiError, clientAddress, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

const schema = z.object({
  regionKey: z.string().trim().min(8).max(180),
  tankTier: z.enum(["GAL_750", "GAL_1000", "GAL_1250", "GAL_1500", "UNKNOWN"]),
  timingKind: z.enum(["SCHEDULED", "EARLIEST", "URGENT"]),
  requestedServiceDate: z.iso.date(),
});

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);

  const allowed = await consumeRateLimit(
    hashRateLimitKey(`marketplace-match-preview:${clientAddress(request)}`),
    30,
    3600,
  );
  if (!allowed) return apiError("RATE_LIMITED", "Too many match previews", 429);

  try {
    const body = await parseJson(request, schema);
    const client = await createSupabaseAuthClient();
    if (!client) return apiError("PROVIDER_UNAVAILABLE", "Marketplace matching preview is not configured", 503);

    const { data, error } = await client.rpc("marketplace_match_preview", {
      p_region_key: body.regionKey,
      p_tank_tier: body.tankTier,
      p_timing_kind: body.timingKind,
      p_requested_service_date: body.requestedServiceDate,
    });

    if (error) {
      if (error.code === "22023") return apiError("BAD_REQUEST", "Invalid marketplace preview request", 400);
      return apiError("PROVIDER_UNAVAILABLE", "Marketplace matching preview is temporarily unavailable", 503);
    }

    return Response.json({ preview: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("BAD_REQUEST", "Invalid marketplace preview request", 400, error.flatten());
    }
    return apiError("INTERNAL_ERROR", "Marketplace matching preview failed", 500);
  }
}
