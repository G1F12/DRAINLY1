import { z } from "zod";

import { allowDemoFallback } from "@/lib/demo-boundary";
import { apiError } from "@/lib/http";
import { getAuthenticatedUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return apiError("BAD_REQUEST", "Invalid order id", 400);

  const user = await getAuthenticatedUser();
  const client = await createSupabaseServerClient();

  if (!client) {
    if (allowDemoFallback()) {
      return Response.json({ id: parsed.data, status: "SEARCHING_CONTRACTOR", demo: true });
    }
    if (!user) return apiError("UNAUTHENTICATED", "Sign in to view this order", 401);
    return apiError("PROVIDER_UNAVAILABLE", "Controlled customer order reads are not enabled", 503);
  }

  if (!user) return apiError("UNAUTHENTICATED", "Sign in to view this order", 401);

  const { data, error } = await client
    .from("customer_orders")
    .select("*")
    .eq("id", parsed.data)
    .maybeSingle();

  if (error) return apiError("INTERNAL_ERROR", "Order could not be loaded", 500);
  if (!data) return apiError("FORBIDDEN", "Order is unavailable", 403);
  return Response.json(data);
}