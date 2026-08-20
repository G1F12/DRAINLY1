import { z } from "zod";

import { apiError } from "@/lib/http";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

const querySchema = z.object({ path: z.string().min(38).max(500).regex(/^[0-9a-f-]{36}\/[0-9a-f-]+\.(jpg|png|webp)$/i) });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  const client = await createSupabaseServerClient();
  if (!user || !client) return apiError("UNAUTHENTICATED", "Sign in to view service proof", 401);
  const parsed = querySchema.safeParse({ path: new URL(request.url).searchParams.get("path") });
  if (!parsed.success) return apiError("BAD_REQUEST", "Invalid proof path", 400);
  const { data, error } = await client.storage.from("job-proofs").createSignedUrl(parsed.data.path, 60);
  if (error || !data) return apiError("FORBIDDEN", "Proof is not available to this account", 403);
  return Response.json({ url: data.signedUrl, expiresInSeconds: 60 }, { headers: { "Cache-Control": "private, no-store" } });
}
