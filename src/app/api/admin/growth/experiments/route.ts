import { z } from "zod";

import { apiError, parseJson, requireSameOrigin } from "@/lib/http";
import { getGrowthSystemDb } from "@/lib/system-db";
import { createSupabaseAuthClient, getAuthenticatedUser } from "@/lib/supabase/auth";

const schema = z.object({
  experimentKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
  hypothesis: z.string().trim().min(10).max(1000),
  guardrail: z.string().trim().min(5).max(1000),
  status: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED"]),
});

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const user = await getAuthenticatedUser();
  if (!user) return apiError("UNAUTHENTICATED", "Sign in to manage growth experiments", 401);
  const client = await createSupabaseAuthClient();
  if (!client) return apiError("PROVIDER_UNAVAILABLE", "Admin auth is unavailable", 503);
  const actor = await client.from("current_admin_context").select("admin_id").maybeSingle();
  if (actor.error || !actor.data) return apiError("FORBIDDEN", "Active Drainly admin access is required", 403);

  try {
    const body = await parseJson(request, schema);
    const sql = getGrowthSystemDb();
    if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Growth operations database is unavailable", 503);
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select internal.set_growth_experiment(${user.id}::uuid, ${body.experimentKey}, ${body.hypothesis}, ${body.guardrail}, ${body.status}) as result
    `;
    return Response.json(rows[0]?.result ?? { experimentKey: body.experimentKey, status: body.status });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid growth experiment", 400, error.flatten());
    return apiError("CONFLICT", "Unable to update growth experiment", 409);
  }
}
