import { apiError, requireSameOrigin } from "@/lib/http";
import { createSupabaseAuthClient } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);

  const client = await createSupabaseAuthClient();
  if (!client) return Response.json({ signedOut: true });

  const { error } = await client.auth.signOut();
  if (error) return apiError("PROVIDER_UNAVAILABLE", "Unable to sign out", 503);

  return Response.json(
    { signedOut: true },
    { headers: { "cache-control": "no-store" } },
  );
}
