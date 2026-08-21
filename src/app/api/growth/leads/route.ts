import { z } from "zod";

import { apiError, clientAddress, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeGrowthRateLimit } from "@/lib/rate-limit";
import { getGrowthSystemDb } from "@/lib/system-db";

const schema = z.object({
  email: z.email().max(254),
  consent: z.literal(true),
  leadType: z.enum(["CUSTOMER_WAITLIST", "CONTRACTOR_INTEREST"]),
  countyCode: z.enum(["JOHNSTON_NC", "HARNETT_NC", "UNKNOWN", "OTHER"]),
  source: z.enum(["HOME_UNAVAILABLE", "HOME_UNSUPPORTED", "CONTRACTOR_PAGE", "SERVICE_AREA", "REFERRAL", "OTHER"]),
});

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const allowed = await consumeGrowthRateLimit(hashRateLimitKey(`growth-lead:${clientAddress(request)}`), 8, 3600);
  if (!allowed) return apiError("RATE_LIMITED", "Too many requests. Try again later.", 429);

  try {
    const body = await parseJson(request, schema);
    const sql = getGrowthSystemDb();
    if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Growth intake is temporarily unavailable", 503);
    const rows = await sql<{ result: { accepted?: boolean } }[]>`
      select internal.capture_growth_lead(${body.leadType}, ${body.email}, ${body.countyCode}, ${body.source}) as result
    `;
    return Response.json({ accepted: rows[0]?.result?.accepted === true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid pilot update request", 400, error.flatten());
    return apiError("INTERNAL_ERROR", "Unable to save pilot update request", 500);
  }
}
