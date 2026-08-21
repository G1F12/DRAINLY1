"use client";

import { CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

type ConnectStatus = {
  profileRequired?: boolean;
  connected?: boolean;
  sandboxOnly?: boolean;
  livePayoutsEnabled?: boolean;
  transferCapabilityStatus?: string;
  connectReady?: boolean;
  syncedAt?: string | null;
  error?: { message?: string };
};

export function ContractorConnectSandboxPanel() {
  const [status, setStatus] = useState<ConnectStatus>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/contractor/connect/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as ConnectStatus;
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error?.message ?? "Unable to load Stripe sandbox payout status.");
          return;
        }
        setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load Stripe sandbox payout status.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function startOnboarding() {
    setStarting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/contractor/connect/onboarding", {
        method: "POST",
        headers: { "idempotency-key": `connect-${crypto.randomUUID()}` },
      });
      const data = await response.json() as { url?: string; error?: { message?: string } };
      if (!response.ok || !data.url) {
        setError(data.error?.message ?? "Unable to start Stripe sandbox onboarding.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Unable to start Stripe sandbox onboarding.");
    } finally {
      setStarting(false);
    }
  }

  return <section className="panel">
    <div className="panel-header">
      <div>
        <h2>Stripe payout onboarding</h2>
        <p className="fine-print">Sandbox only. Stripe collects identity and bank details on its hosted onboarding page. Drainly does not receive raw bank or identity documents.</p>
      </div>
      <span className="status status-info">TEST</span>
    </div>

    {loading ? <div><LoaderCircle className="animate-spin" size={20} /> Checking Stripe sandbox status...</div> : <div className="stack">
      {status?.connectReady ? <div className="success-box">
        <CheckCircle2 size={17} style={{ display: "inline", marginRight: 7 }} />
        Stripe sandbox transfer capability is active. This still does not enable live payouts or live customer charges.
      </div> : <div className="fine-print">
        {status?.profileRequired
          ? "Save the contractor profile first, then start Stripe sandbox payout onboarding."
          : status?.connected
            ? `Stripe sandbox account connected. Transfer capability: ${status.transferCapabilityStatus ?? "pending"}.`
            : "No Stripe sandbox payout account is connected yet."}
      </div>}

      {error && <div className="form-error" role="alert">{error}</div>}

      {!status?.profileRequired && !status?.connectReady && <div>
        <button className="button button-secondary" type="button" disabled={starting} onClick={startOnboarding}>
          {starting
            ? <><LoaderCircle size={17} className="animate-spin" /> Opening Stripe...</>
            : <><ExternalLink size={17} /> {status?.connected ? "Continue Stripe sandbox onboarding" : "Start Stripe sandbox onboarding"}</>}
        </button>
      </div>}

      <div className="fine-print"><ShieldCheck size={14} style={{ display: "inline", marginRight: 5 }} />Live payouts enabled: no.</div>
    </div>}
  </section>;
}
