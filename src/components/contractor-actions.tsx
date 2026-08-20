"use client";

import { useState } from "react";

export function OfferActions({ offerId }: { offerId: string }) {
  const [state, setState] = useState<string>();
  async function act(action: "accept" | "decline") { setState("Working…"); const response = await fetch(`/api/contractor/offers/${offerId}/${action}`, { method: "POST", headers: { "idempotency-key": `${action}-${crypto.randomUUID()}` } }); const data = await response.json() as { error?: { message?: string } }; setState(response.ok ? action === "accept" ? "Accepted" : "Declined" : data.error?.message ?? "Failed"); }
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{state ? <span className="status status-info">{state}</span> : <><button className="button button-primary" style={{ minHeight: 38, paddingInline: 12 }} onClick={() => act("accept")}>Accept</button><button className="button button-ghost" style={{ minHeight: 38, paddingInline: 12 }} onClick={() => act("decline")}>Decline</button></>}</div>;
}

export function JobActions({ orderId, status }: { orderId: string; status: string }) {
  const [current, setCurrent] = useState(status); const [error, setError] = useState<string>();
  const action = current === "SCHEDULED" ? "MARK_EN_ROUTE" : current === "EN_ROUTE" ? "MARK_ARRIVED" : current === "ARRIVED" ? "COMPLETE" : null;
  async function advance() { if (!action) return; const response = await fetch(`/api/contractor/jobs/${orderId}/action`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${action}-${crypto.randomUUID()}` }, body: JSON.stringify({ action }) }); const data = await response.json() as { status?: string; error?: { message?: string } }; if (!response.ok) setError(data.error?.message ?? "Action failed"); else { setCurrent(data.status ?? current); setError(undefined); } }
  return <div>{action && <button className="button button-primary" style={{ minHeight: 38, paddingInline: 12 }} onClick={advance}>{action === "MARK_EN_ROUTE" ? "Start route" : action === "MARK_ARRIVED" ? "Mark arrived" : "Complete job"}</button>}{error && <div className="list-sub" style={{ color: "var(--danger)", marginTop: 6 }}>{error}</div>}</div>;
}
