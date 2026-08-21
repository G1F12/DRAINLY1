import { TZDate } from "@date-fns/tz";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { apiError, clientAddress, getIdempotencyKey, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getSystemDb } from "@/lib/system-db";
import { getGeocoder } from "@/modules/geography/geocoder";
import { createFakeQuote } from "@/modules/quotes/fake-service";

const schema = z.object({
  addressLine1: z.string().trim().min(5).max(160),
  city: z.string().trim().min(2).max(80),
  stateCode: z.string().trim().length(2),
  postalCode: z.string().regex(/^\d{5}$/),
  tankTier: z.enum(["GAL_750", "GAL_1000", "GAL_1250", "GAL_1500", "UNKNOWN"]),
  accessType: z.enum(["ATTENDED", "UNATTENDED"]),
  timingKind: z.enum(["SCHEDULED", "EARLIEST", "URGENT"]),
  requestedServiceDate: z.iso.date(),
  serviceNotes: z.string().trim().max(2000).optional(),
});

function deterministicUuid(value: string) {
  const source = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  source[12] = "4";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  const allowed = await consumeRateLimit(hashRateLimitKey(`quote:${clientAddress(request)}`), 20, 3600);
  if (!allowed) return apiError("RATE_LIMITED", "Too many quote requests", 429);
  try {
    const body = await parseJson(request, schema);
    const address = await getGeocoder().normalize(body);
    const providerMode = (process.env.PROVIDER_MODE ?? "fake").trim().toLowerCase();
    if (providerMode === "fake") {
      return Response.json({
        ...createFakeQuote({ normalizedAddress: address, tankTier: body.tankTier, timingKind: body.timingKind }),
        quoteId: deterministicUuid(idempotencyKey),
        address,
        demo: true,
      });
    }
    if (providerMode !== "real") {
      return apiError("INTERNAL_ERROR", "Service provider mode is misconfigured", 500);
    }

    const sql = getSystemDb();
    if (!sql) {
      return apiError("PROVIDER_UNAVAILABLE", "Trusted quote database path is not configured", 503);
    }

    const [year, month, day] = body.requestedServiceDate.split("-").map(Number);
    const serviceWindow = new TZDate(year!, month! - 1, day!, 8, 0, 0, "America/New_York");
    const rows = await sql<{ quote: Record<string, unknown> }[]>`
      select api.create_quote(
        ${address.regionKey ?? "UNSUPPORTED"}, ${body.tankTier}::domain.tank_tier,
        ${body.timingKind}::domain.timing_kind, ${body.accessType}::domain.access_type,
        ${body.requestedServiceDate}::date, ${serviceWindow.toISOString()}::timestamptz,
        ${sql.json({
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        stateCode: address.stateCode,
        postalCode: address.postalCode,
        countyName: address.countyName,
        normalizedAddress: address.normalizedAddress,
        latitude: address.latitude,
        longitude: address.longitude,
        accessInstructions: body.accessType === "UNATTENDED" ? body.serviceNotes ?? "" : "Customer will be present",
        })}::jsonb, ${idempotencyKey}, ${body.serviceNotes ?? null}) as quote
    `;
    const quote = rows[0]?.quote ?? {};
    const quoteId = typeof quote.quoteId === "string" ? quote.quoteId : typeof quote.id === "string" ? quote.id : null;
    const referralCode = (await cookies()).get("drainly_ref")?.value;
    if (quoteId && referralCode) {
      try {
        await sql`select internal.attribute_referral_quote(${referralCode}, ${quoteId}::uuid)`;
      } catch {
        // Referral attribution must never block a real quote.
      }
    }
    return Response.json({ ...quote, address });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid quote request", 400, error.flatten());
    console.error("[api/quotes] quote creation failed", error);
    const message = process.env.NODE_ENV === "production"
      ? "Unable to create quote"
      : error instanceof Error ? error.message : "Unable to create quote";
    return apiError("PROVIDER_UNAVAILABLE", message, 503);
  }
}
