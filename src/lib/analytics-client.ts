"use client";

import posthog from "posthog-js";

export type GrowthEvent =
  | "quote_submit"
  | "quote_result"
  | "quote_error"
  | "quote_continue"
  | "growth_cta_click"
  | "growth_lead_submit"
  | "growth_lead_success"
  | "referral_create"
  | "referral_copy";

type GrowthProperties = {
  status?: "PRICED" | "REVIEW_REQUIRED" | "UNAVAILABLE" | "UNSUPPORTED";
  demo?: boolean;
  audience?: "customer" | "contractor";
  placement?: "home_contractor" | "contractor_hero" | "quote_result" | "service_area" | "customer_dashboard";
};

export function captureGrowthEvent(event: GrowthEvent, properties: GrowthProperties = {}): void {
  if (typeof window === "undefined" || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

  // Non-identifying only: never pass address/ZIP, names, email, phone,
  // quote/order/referral IDs, notes, or query strings to growth analytics.
  posthog.capture(event, properties);
}
