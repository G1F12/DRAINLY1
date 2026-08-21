import { apiError, requireSameOrigin } from "@/lib/http";
import { getGrowthSystemDb } from "@/lib/system-db";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to create a referral link", 401);
  const sql = getGrowthSystemDb();
  if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Referral links are unavailable", 503);
  try {
    const rows = await sql<{ result: { code?: string } }[]>`select internal.ensure_customer_referral_code(${user.id}::uuid) as result`;
    const code = rows[0]?.result?.code;
    if (!code) return apiError("CONFLICT", "A completed Drainly order is required before creating a referral link", 409);
    return Response.json({ code });
  } catch {
    return apiError("CONFLICT", "A completed Drainly order is required before creating a referral link", 409);
  }
}
