"use client";

import { ArrowRight, CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { safeInternalPath } from "@/lib/navigation";

export function SignInForm() {
  const params = useSearchParams();
  const next = safeInternalPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [demoCode, setDemoCode] = useState<string>();

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    const response = await fetch("/api/auth/otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `otp-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ email }),
    });
    const data = await response.json() as { demoCode?: string; error?: { message?: string } };
    setLoading(false);
    if (!response.ok) return setError(data.error?.message ?? "Unable to send code");
    setDemoCode(data.demoCode);
    setStep("code");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `otp-verify-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ email, token, phone: phone || undefined }),
    });
    const data = await response.json() as { verified?: boolean; error?: { message?: string } };
    setLoading(false);
    if (!response.ok || !data.verified) return setError(data.error?.message ?? "That code did not work");
    window.location.assign(next);
  }

  return <div className="auth-card">
    <div className="eyebrow"><Mail size={16} /> Secure booking access</div>
    <h1>No password needed.</h1>
    <p>We&apos;ll email a six-digit code so you can book and return to your service details securely.</p>
    {step === "email"
      ? <form className="stack" onSubmit={sendCode}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="email" required placeholder="you@example.com" />
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary" disabled={loading}>
            {loading ? <LoaderCircle size={18} className="animate-spin" /> : <><span>Email my code</span><ArrowRight size={18} /></>}
          </button>
        </form>
      : <form className="stack" onSubmit={verify}>
          <div className="success-box">
            <CheckCircle2 size={17} style={{ display: "inline", marginRight: 7 }} />
            Code sent to <strong>{email}</strong>
            {demoCode && <div className="fine-print" style={{ marginTop: 7 }}>Local demo code: <strong>{demoCode}</strong></div>}
          </div>
          <div className="field">
            <label htmlFor="token">Six-digit code</label>
            <input id="token" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
              value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code" required placeholder="123456" />
          </div>
          <div className="field">
            <label htmlFor="phone">Mobile number <span style={{ fontWeight: 500 }}>(for service updates)</span></label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel" placeholder="(919) 555-0123" />
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary" disabled={loading || token.length !== 6}>
            {loading ? <LoaderCircle size={18} className="animate-spin" /> : "Verify and continue"}
          </button>
          <button type="button" className="button button-ghost" onClick={() => { setStep("email"); setToken(""); }}>
            Use another email
          </button>
        </form>}
    <div className="fine-print" style={{ marginTop: 20 }}>
      Your booking and proof links are never made publicly accessible. Standard email delivery rates apply;
      SMS consent is collected separately before production messaging.
    </div>
  </div>;
}