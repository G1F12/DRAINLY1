import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getSystemDb } from "@/lib/system-db";
import { getPaymentGateway } from "@/modules/payments/gateway";
import { scheduleNotificationDrain } from "@/modules/notifications/dispatch";

const schema = z.object({
  quoteId: z.uuid(),
  stripeCustomerId: z.string().min(3).max(255),
  paymentMethodId: z.string().min(3).max(255),
  setupIntentId: z.string().min(3).max(255),
  offSessionConsentAccepted: z.literal(true),
  consentVersion: z.literal("pilot-v1"),
});

export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const key = getIdempotencyKey(request);
  if (!key) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const client = await createSupabaseServerClient();
    const user = await getCurrentUser();
    if (!client || !user) {
      if (process.env.PROVIDER_MODE !== "real") return Response.json({ orderId: crypto.randomUUID(), publicRef: "DRN-DEMO-BOOK", status: "SEARCHING_CONTRACTOR", demo: true });
      return apiError("UNAUTHENTICATED", "Verified customer sign-in is required", 401);
    }
    const verifiedSetup = await getPaymentGateway().verifySetupIntent(body.setupIntentId);
    if (verifiedSetup.customerId !== body.stripeCustomerId || verifiedSetup.paymentMethodId !== body.paymentMethodId) {
      return apiError("FORBIDDEN", "Payment setup does not match this booking", 403);
    }
    const sql = getSystemDb();
    if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Trusted payment verification database path is not configured", 503);
    await sql`select internal.record_verified_setup_intent(
      ${user.id}::uuid, ${verifiedSetup.setupIntentId}, ${verifiedSetup.customerId}, ${verifiedSetup.paymentMethodId},
      ${verifiedSetup.status}, ${verifiedSetup.usage}, ${body.consentVersion}, ${new Date().toISOString()}::timestamptz
    )`;
    const { data, error } = await client.rpc("create_booking", {
      p_quote_id: body.quoteId,
      p_stripe_customer_id: body.stripeCustomerId,
      p_payment_method_id: body.paymentMethodId,
      p_setup_intent_id: body.setupIntentId,
      p_idempotency_key: key,
    });
    if (error) return apiError("CONFLICT", error.message, 409);
    scheduleNotificationDrain();
    return Response.json(data);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid booking", 400, error.flatten());
    return apiError("INTERNAL_ERROR", "Booking could not be created", 500);
  }
}
