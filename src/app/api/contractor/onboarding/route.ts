import { z } from "zod";

import { apiError, getIdempotencyKey, hashRateLimitKey, parseJson, requireSameOrigin } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

const regionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ZIP"),
    stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    postalCode: z.string().trim().regex(/^[0-9]{5}$/),
  }),
  z.object({
    kind: z.literal("COUNTY"),
    stateCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    countyName: z.string().trim().min(2).max(120),
  }),
]);

const availabilitySchema = z.object({
  isoWeekday: z.number().int().min(1).max(7),
  maxJobs: z.number().int().min(0).max(100),
  urgentEnabled: z.boolean(),
});

const priceSchema = z.object({
  tankTier: z.enum(["GAL_750", "GAL_1000", "GAL_1250", "GAL_1500"]),
  scheduledCents: z.number().int().min(100).max(10_000_000),
  urgentCents: z.number().int().min(100).max(10_000_000),
}).refine((value) => value.urgentCents >= value.scheduledCents, {
  message: "Urgent price cannot be below scheduled price",
  path: ["urgentCents"],
});

const saveSchema = z.object({
  company: z.object({
    legalName: z.string().trim().min(2).max(160),
    displayName: z.string().trim().min(2).max(120),
    primaryContactName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(7).max(30),
    operatingAddress: z.string().trim().max(240).optional(),
  }),
  regions: z.array(regionSchema).min(1).max(40),
  availability: z.array(availabilitySchema).min(1).max(7),
  prices: z.array(priceSchema).length(4).refine(
    (rows) => new Set(rows.map((row) => row.tankTier)).size === 4,
    "All four tank sizes must have a price",
  ),
  licenseReference: z.string().trim().max(160).optional(),
  insuranceReference: z.string().trim().max(160).optional(),
});

async function authenticatedClient() {
  const client = await createSupabaseAuthClient();
  if (!client) return { client: null, user: null };
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { client, user: null };
  return { client, user: data.user };
}

function rpcError(error: { code?: string; message?: string }) {
  if (error.code === "42501") return apiError("FORBIDDEN", "Your contractor profile cannot be changed from this account.", 403);
  if (error.code === "P0001") return apiError("CONFLICT", "This contractor profile needs manual review before it can be changed.", 409);
  if (error.code === "22023" || error.code === "22P02" || error.code === "23505") {
    return apiError("BAD_REQUEST", "Check the company, service area, capacity, and pricing fields.", 400);
  }
  return apiError("INTERNAL_ERROR", "Contractor profile service is temporarily unavailable.", 500);
}

export async function GET() {
  const { client, user } = await authenticatedClient();
  if (!client) return apiError("PROVIDER_UNAVAILABLE", "Real sign-in is required for contractor onboarding.", 503);
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage a contractor profile.", 401);

  const { data, error } = await client.rpc("contractor_onboarding_get", {});
  if (error) return rpcError(error);
  return Response.json({ profile: data });
}

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);

  const { client, user } = await authenticatedClient();
  if (!client) return apiError("PROVIDER_UNAVAILABLE", "Real sign-in is required for contractor onboarding.", 503);
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage a contractor profile.", 401);

  const bucket = hashRateLimitKey(`contractor-onboarding:${user.id}`);
  if (!(await consumeRateLimit(bucket, 20, 3600))) {
    return apiError("RATE_LIMITED", "Too many contractor profile updates. Try again later.", 429);
  }

  try {
    const body = await parseJson(request, saveSchema);
    const { data, error } = await client.rpc("contractor_onboarding_save", {
      p_company: body.company,
      p_regions: body.regions,
      p_availability: body.availability,
      p_prices: body.prices,
      p_license_reference: body.licenseReference || undefined,
      p_insurance_reference: body.insuranceReference || undefined,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return rpcError(error);
    return Response.json({ profile: data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("BAD_REQUEST", "Check the contractor onboarding fields.", 400, error.flatten());
    }
    return apiError("INTERNAL_ERROR", "Contractor profile could not be saved.", 500);
  }
}
