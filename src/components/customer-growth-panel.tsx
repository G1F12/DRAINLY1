"use client";

import { CheckCircle2, Copy, LoaderCircle, Share2 } from "lucide-react";
import { useState } from "react";

import { captureGrowthEvent } from "@/lib/analytics-client";

export interface CustomerGrowthBundle {
  customerExists: boolean;
  annualServiceCheckin: boolean;
  referralEligible: boolean;
  referralCode?: string | null;
}

export function CustomerGrowthPanel({ initial }: { initial: CustomerGrowthBundle }) {
  const [annualCheckin, setAnnualCheckin] = useState(initial.annualServiceCheckin);
  const [referralCode, setReferralCode] = useState(initial.referralCode ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function savePreference() {
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const response = await fetch("/api/growth/customer/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ annualServiceCheckin: annualCheckin }),
      });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Unable to save reminder preference.");
      setMessage("Reminder preference saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save reminder preference.");
    } finally { setSaving(false); }
  }

  async function createReferral() {
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const response = await fetch("/api/growth/referral", { method: "POST" });
      const data = await response.json() as { code?: string; error?: { message?: string } };
      if (!response.ok || !data.code) throw new Error(data.error?.message ?? "Unable to create referral link.");
      setReferralCode(data.code);
      setMessage("Referral link created.");
      captureGrowthEvent("referral_create", { audience: "customer", placement: "customer_dashboard" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create referral link.");
    } finally { setSaving(false); }
  }

  async function copyReferral() {
    if (!referralCode) return;
    await navigator.clipboard.writeText(`${window.location.origin}/r/${referralCode}`);
    setMessage("Referral link copied.");
    captureGrowthEvent("referral_copy", { audience: "customer", placement: "customer_dashboard" });
  }

  return <section className="panel">
    <div className="panel-header"><div><h2>Reminders & referrals</h2><p className="fine-print">Optional retention tools. Referral tracking does not promise a discount, credit, or reward.</p></div></div>
    {!initial.customerExists ? <div className="panel-body fine-print">These options become available after Drainly has a customer profile associated with a booking.</div> : <div className="panel-body stack">
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><input type="checkbox" checked={annualCheckin} onChange={(event) => setAnnualCheckin(event.target.checked)} style={{ width: 17, height: 17, marginTop: 3 }} /><span><strong>Annual service check-in</strong><span className="fine-print" style={{ display: "block" }}>After a completed Drainly service, send one check-in about a year later. It is not a statement that pumping is required.</span></span></label>
      <div><button type="button" className="button button-secondary" onClick={savePreference} disabled={saving}>{saving ? <><LoaderCircle size={16} className="animate-spin" /> Saving...</> : "Save reminder preference"}</button></div>
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
        <strong>Share Drainly</strong>
        <p className="fine-print">Referral links become available after a completed Drainly order. They measure introductions only; no reward is promised.</p>
        {referralCode ? <button type="button" className="button button-secondary" onClick={copyReferral}><Copy size={16} /> Copy referral link</button> : initial.referralEligible ? <button type="button" className="button button-secondary" onClick={createReferral} disabled={saving}><Share2 size={16} /> Create referral link</button> : <span className="status status-info">Available after first completed order</span>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-box" role="status"><CheckCircle2 size={16} style={{ display: "inline", marginRight: 6 }} />{message}</div>}
    </div>}
  </section>;
}
