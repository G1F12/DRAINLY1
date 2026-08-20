import { z } from "zod";

import { apiError } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const idSchema = z.uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return apiError("BAD_REQUEST", "Invalid order id", 400);
  const client = await createSupabaseServerClient();
  if (!client) return Response.json({ id: parsed.data, status: "SEARCHING_CONTRACTOR", demo: true });
  const { data, error } = await client.from("customer_orders").select("*").eq("id", parsed.data).maybeSingle();
  if (error) return apiError("INTERNAL_ERROR", "Order could not be loaded", 500);
  if (!data) return apiError("FORBIDDEN", "Order is unavailable", 403);
  return Response.json(data);
}
