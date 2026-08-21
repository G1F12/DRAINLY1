import { NextResponse } from "next/server";

import { clientAddress, hashRateLimitKey } from "@/lib/http";
import { consumeGrowthRateLimit } from "@/lib/rate-limit";
import { getGrowthSystemDb } from "@/lib/system-db";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/", request.url);
  if (!/^[A-Z0-9]{8,16}$/i.test(code)) return NextResponse.redirect(home, 303);

  const allowed = await consumeGrowthRateLimit(hashRateLimitKey(`referral-visit:${clientAddress(request)}`), 120, 3600);
  if (!allowed) return NextResponse.redirect(home, 303);

  let accepted = false;
  const sql = getGrowthSystemDb();
  if (sql) {
    try {
      const rows = await sql<{ accepted: boolean }[]>`select internal.record_referral_visit(${code}, ${"/"}) as accepted`;
      accepted = rows[0]?.accepted === true;
    } catch {
      accepted = false;
    }
  }

  const response = NextResponse.redirect(home, 303);
  if (accepted) {
    response.cookies.set("drainly_ref", code.toUpperCase(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}
