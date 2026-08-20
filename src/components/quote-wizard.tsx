"use client";

import { ArrowRight, CheckCircle2, LoaderCircle, MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { formatUsd } from "@/modules/pricing/money";

type QuoteResult = {
  quoteId: string;
  status: "PRICED" | "REVIEW_REQUIRED" | "UNAVAILABLE" | "UNSUPPORTED";
  customerTotalCents?: number;
  expiresAt?: string;
  viableCandidateCount?: number;
  address?: { normalizedAddress: string; countyName: string };
};

function tomorrowDate() {
  const date = new Date(); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10);
}

export function QuoteWizard() {
  const minDate = useMemo(() => tomorrowDate(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<QuoteResult>();

  async function submit(formData: FormData) {
    setLoading(true); setError(undefined); setResult(undefined);
    const payload = Object.fromEntries(formData.entries());
    try {
      const response = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `quote-${crypto.randomUUID()}` }, body: JSON.stringify(payload) });
      const data = await response.json() as QuoteResult & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "We could not prepare this quote.");
      setResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not prepare this quote."); }
    finally { setLoading(false); }
  }

  return <div className="quote-card" id="get-a-quote"><h2>Check your address</h2><p>See a firm pilot price only when eligible contractor supply is available.</p>
    {!result && <form action={submit} className="form-grid">
      <div className="field field-full"><label htmlFor="addressLine1">Street address</label><div style={{ position: "relative" }}><MapPin size={17} aria-hidden style={{ position: "absolute", left: 12, top: 15, color: "#627171" }} /><input id="addressLine1" name="addressLine1" placeholder="123 Main Street" required minLength={5} maxLength={160} style={{ paddingLeft: 38 }} autoComplete="street-address" /></div></div>
      <div className="field"><label htmlFor="city">City</label><input id="city" name="city" placeholder="Smithfield" required autoComplete="address-level2" /></div>
      <div className="field"><label htmlFor="postalCode">ZIP code</label><input id="postalCode" name="postalCode" placeholder="27577" inputMode="numeric" pattern="[0-9]{5}" required autoComplete="postal-code" /><input type="hidden" name="stateCode" value="NC" /></div>
      <div className="field"><label htmlFor="tankTier">Tank size</label><select id="tankTier" name="tankTier" defaultValue="GAL_1000"><option value="GAL_750">750 gallons</option><option value="GAL_1000">1,000 gallons</option><option value="GAL_1250">1,250 gallons</option><option value="GAL_1500">1,500 gallons</option><option value="UNKNOWN">I&apos;m not sure</option></select></div>
      <div className="field"><label htmlFor="requestedServiceDate">Preferred date</label><input id="requestedServiceDate" type="date" name="requestedServiceDate" min={minDate} defaultValue={minDate} required /></div>
      <div className="field"><label htmlFor="timingKind">Timing</label><select id="timingKind" name="timingKind" defaultValue="SCHEDULED"><option value="SCHEDULED">This date</option><option value="EARLIEST">Earliest available</option><option value="URGENT">Urgent / same-day check</option></select></div>
      <div className="field"><label htmlFor="accessType">Access</label><select id="accessType" name="accessType" defaultValue="ATTENDED"><option value="ATTENDED">I&apos;ll be present</option><option value="UNATTENDED">Unattended access</option></select></div>
      <div className="field field-full"><label htmlFor="serviceNotes">Property or access notes <span style={{ fontWeight: 500 }}>(optional)</span></label><textarea id="serviceNotes" name="serviceNotes" maxLength={2000} placeholder="Gate, lid location, driveway, or other useful details" /></div>
      {error && <div className="form-error field-full" role="alert">{error}</div>}
      <button className="button button-primary field-full" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={18} className="animate-spin" /> Checking coverage and supply…</> : <>See my price <ArrowRight size={18} /></>}</button>
      <div className="fine-print field-full">Submitting does not guarantee an appointment. Drainly verifies coverage, current contractor eligibility, capacity, and marketplace economics on the server.</div>
    </form>}
    {result?.status === "PRICED" && <div className="quote-result" aria-live="polite"><div className="eyebrow"><CheckCircle2 size={16} /> Firm pilot quote</div><div><div className="price">{formatUsd(result.customerTotalCents ?? 0)}</div><div className="list-sub">Customer total • card saved now, captured after completed service</div></div><div><strong>{result.address?.countyName}</strong><div className="list-sub">{result.address?.normalizedAddress}</div></div><div className="fine-print">Based on {result.viableCandidateCount ?? 1} currently viable contractor candidate{(result.viableCandidateCount ?? 1) === 1 ? "" : "s"}. Eligibility and capacity are checked again at booking and acceptance.</div><Link className="button button-primary" href={`/book?quote=${result.quoteId}`}>Continue securely <ArrowRight size={18} /></Link><button className="button button-ghost" type="button" onClick={() => setResult(undefined)}>Change details</button></div>}
    {result && result.status !== "PRICED" && <div className="quote-result" aria-live="polite"><strong>{result.status === "UNSUPPORTED" ? "We don’t serve this address yet" : result.status === "UNAVAILABLE" ? "No current contractor capacity for that date" : "This request needs a manual review"}</strong><p style={{ margin: 0, color: "var(--muted)" }}>{result.status === "REVIEW_REQUIRED" ? "We won’t invent a firm price when tank details or marketplace economics are uncertain. Leave your details and our pilot team can review it." : "Try another supported date or contact the pilot team for help."}</p><button className="button button-secondary" type="button" onClick={() => setResult(undefined)}>Try different details</button></div>}
  </div>;
}
