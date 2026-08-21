import { NextResponse } from "next/server";

import { safeInternalPath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const safeNext = safeInternalPath(url.searchParams.get("next"));
  const client = await createSupabaseServerClient();

  if (code && client) await client.auth.exchangeCodeForSession(code);

  return NextResponse.redirect(new URL(safeNext, url.origin));
}