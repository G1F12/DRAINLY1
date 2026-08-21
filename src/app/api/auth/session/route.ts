import { createSupabaseAuthClient } from "@/lib/supabase/auth";

export async function GET() {
  const client = await createSupabaseAuthClient();
  if (!client) {
    return Response.json(
      { signedIn: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return Response.json(
      { signedIn: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const { data: contractor } = await client
    .from("current_contractor_context")
    .select("contractor_company_id,company_status,user_active")
    .maybeSingle();

  let dashboardHref = "/customer";
  if (contractor?.contractor_company_id && contractor.user_active) {
    dashboardHref = contractor.company_status === "APPROVED"
      ? "/contractor"
      : "/contractor/onboarding";
  }

  return Response.json(
    { signedIn: true, dashboardHref },
    { headers: { "cache-control": "no-store" } },
  );
}
