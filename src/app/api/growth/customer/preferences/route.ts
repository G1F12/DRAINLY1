import { z } from "zod";

import { apiError, parseJson, requireSameOrigin } from "@/lib/http";
import { getGrowthSystemDb } from "@/lib/system-db";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

const schema = z.object({ annualServiceCheckin: z.boolean() });

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage reminder preferences", 401);
  const sql = getGrowthSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Reminder preferences are unavailable", 503);
  const rows = await sql<{ bundle: Record<string, unknown> }[]>`select internal.get_customer_growth_bundle(${user.id}::uuid) as bundle`;
  return Response.json(rows[0]?.bundle ?? { customerExists: false, annualServiceCheckin: false, referralEligible: false, referralCode: null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage reminder preferences", 401);
  try {
    const body = await parseJson(request, schema);
    const sql = getGrowthSystemDb();
    if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Reminder preferences are unavailable", 503);
    const rows = await sql<{ result: Record<string, unknown> }[]>`select internal.save_customer_growth_preferences(${user.id}::uuid, ${body.annualServiceCheckin}) as result`;
    return Response.json(rows[0]?.result ?? { annualServiceCheckin: body.annualServiceCheckin });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid reminder preference", 400, error.flatten());
    return apiError("CONFLICT", "A customer booking profile is required before reminders can be enabled", 409);
  }
}
