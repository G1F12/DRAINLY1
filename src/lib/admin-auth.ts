import "server-only";

import { createSupabaseAuthClient, getAuthenticatedUser } from "@/lib/supabase/auth";

export async function getAdminContext() {
  const user = await getAuthenticatedUser();
  if (!user) return { user: null, client: null, isAdmin: false };

  const client = await createSupabaseAuthClient();
  if (!client) return { user, client: null, isAdmin: false };

  const { data, error } = await client
    .from("current_admin_context")
    .select("admin_id")
    .maybeSingle();

  return {
    user,
    client,
    isAdmin: !error && Boolean(data),
  };
}