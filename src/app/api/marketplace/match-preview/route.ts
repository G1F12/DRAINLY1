import { z } from "zod";

import { apiError, clientAddress, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getGrowthSystemDb } from "@/lib/system-db";

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
    const sql = getGrowthSystemDb();
    if (!sql) {
      return apiError("PROVIDER_UNAVAILABLE", "Marketplace matching preview is not configured", 503);
    }

    const rows = await sql<{ preview: Record<string, unknown> }[]>`
      select api.marketplace_match_preview(
        ${body.regionKey},
        ${body.tankTier}::domain.tank_tier,
        ${body.timingKind}::domain.timing_kind,
        ${body.requestedServiceDate}::date
      ) as preview
    `;

    return Response.json({ preview: rows[0]?.preview ?? null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("BAD_REQUEST", "Invalid marketplace preview request", 400, error.flatten());
    }
    if (typeof error === "object" && error !== null && "code" in error
      && (error as { code?: string }).code === "22023") {
      return apiError("BAD_REQUEST", "Invalid marketplace preview request", 400);
    }
    return apiError("PROVIDER_UNAVAILABLE", "Marketplace matching preview is temporarily unavailable", 503);
  }
}