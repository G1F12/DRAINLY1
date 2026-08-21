"use client";

import { LoaderCircle, Mail } from "lucide-react";
import { useState } from "react";

import { captureGrowthEvent } from "@/lib/analytics-client";

type LeadType = "CUSTOMER_WAITLIST" | "CONTRACTOR_INTEREST";
type CountyCode = "JOHNSTON_NC" | "HARNETT_NC" | "UNKNOWN" | "OTHER";
type LeadSource = "HOME_UNAVAILABLE" | "HOME_UNSUPPORTED" | "CONTRACTOR_PAGE" | "SERVICE_AREA" | "REFERRAL" | "OTHER";

export function GrowthLeadForm({
  leadType,
  source,
  countyCode = "UNKNOWN",
  title = "Get pilot updates",
}: {
  leadType: LeadType;
  source: LeadSource;
  countyCode?: CountyCode;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    const consent = formData.get("consent") === "on";
    if (!consent) return;
    setLoading(true);
    setMessage(undefined);
    setError(undefined);
    const audience = leadType === "CONTRACTOR_INTEREST" ? "contractor" : "customer";
    captureGrowthEvent("growth_lead_submit", { audience, placement: source === "SERVICE_AREA" ? "service_area" : source === "CONTRACTOR_PAGE" ? "contractor_hero" : "quote_result" });

    try {
      const response = await fetch("/api/growth/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, consent, leadType, countyCode, source }),
      });
      const data = await response.json() as { accepted?: boolean; error?: { message?: string } };
      if (!response.ok || !data.accepted) throw new Error(data.error?.message ?? "Unable to save your request.");
      setMessage("Saved. Drainly can contact you about relevant pilot availability.");
      captureGrowthEvent("growth_lead_success", { audience, placement: source === "SERVICE_AREA" ? "service_area" : source === "CONTRACTOR_PAGE" ? "contractor_hero" : "quote_result" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your request.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="stack" style={{ marginTop: 16 }}>
    <strong>{title}</strong>
    <form action={submit} className="form-grid">
      <div className="field field-full"><label htmlFor={`growth-email-${leadType}-${source}`}>Email</label><div style={{ position: "relative" }}><Mail size={16} aria-hidden style={{ position: "absolute", left: 12, top: 15, color: "#627171" }} /><input id={`growth-email-${leadType}-${source}`} name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" style={{ paddingLeft: 38 }} /></div></div>
      <label className="fine-print field-full" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" name="consent" required style={{ width: 16, height: 16, marginTop: 2 }} /> I agree Drainly may email me about this pilot request. This does not create a booking.</label>
      {error && <div className="form-error field-full" role="alert">{error}</div>}
      {message && <div className="success-box field-full" role="status">{message}</div>}
      {!message && <button className="button button-secondary field-full" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={17} className="animate-spin" /> Saving...</> : "Notify me"}</button>}
    </form>
  </div>;
}
