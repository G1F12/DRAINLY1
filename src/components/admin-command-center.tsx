"use client";

import { useState } from "react";

function commandKey(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

export function AdminOrderActions({ orderId, customerTotalCents, failedPaymentOperation }: { orderId: string; customerTotalCents: number; failedPaymentOperation?: string | null }) {
  const [message, setMessage] = useState<string>();
  async function send(path: string, body: Record<string, unknown>, prefix: string) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": commandKey(prefix) }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Command recorded" : data.error?.message ?? "Command failed");
  }
  return <details style={{ position: "relative" }}><summary className="button button-ghost" style={{ minHeight: 36, paddingInline: 10 }}>Actions</summary><div className="stack" style={{ position: "absolute", right: 0, zIndex: 5, width: 300, padding: 14, background: "white", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow)" }}>
    <button className="button button-secondary" onClick={() => { const reason = prompt("Document the authorization override reason (10+ characters)"); if (reason) void send(`/api/admin/orders/${orderId}/authorization-override`, { reason }, "authorization-override"); }}>Authorization override</button>
    <button className="button button-secondary" onClick={() => { const contractorCompanyId = prompt("Replacement contractor company UUID"); const reason = prompt("Document the reassignment reason (10+ characters)"); if (contractorCompanyId && reason) void send(`/api/admin/orders/${orderId}/reassign`, { replacementContractorCompanyId: contractorCompanyId, reason }, "reassign"); }}>Assign / reassign</button>
    <button className="button button-secondary" onClick={() => { const amount = prompt(`Refund cents (maximum ${customerTotalCents})`); const reason = prompt("Document the refund reason"); if (amount && reason) void send(`/api/admin/orders/${orderId}/refund`, { amountCents: Number(amount), reason }, "refund"); }}>Request refund</button>
    {failedPaymentOperation && <button className="button button-secondary" onClick={() => { const reason = prompt("Document why this failed payment operation is safe to retry (10+ characters)"); if (reason) void send(`/api/admin/orders/${orderId}/payment-retry`, { taskType: failedPaymentOperation, reason }, "payment-retry"); }}>Retry failed {failedPaymentOperation.toLowerCase().replaceAll("_", " ")}</button>}
    <button className="button button-ghost" onClick={() => { const reason = prompt("Document the cancellation reason"); if (reason) void send(`/api/orders/${orderId}/cancel`, { reason }, "admin-cancel"); }}>Cancel order</button>
    {message && <span className="fine-print">{message}</span>}
  </div></details>;
}

export function AdminConfigurationCommands() {
  const [message, setMessage] = useState<string>();
  async function send(path: string, body: Record<string, unknown>, prefix: string) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": commandKey(prefix) }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Audited command recorded" : data.error?.message ?? "Command failed");
  }
  return <section className="panel" style={{ marginTop: 22 }}><div className="panel-header"><h2>Audited configuration commands</h2></div><div className="panel-body form-grid">
    <form className="stack" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void send(`/api/admin/contractors/${values.get("companyId")}/status`, { status: values.get("status"), reason: values.get("reason") }, "contractor-status"); }}><strong>Contractor status</strong><input name="companyId" placeholder="Contractor company UUID" required /><select name="status"><option value="APPROVED">Approve</option><option value="DISABLED">Disable</option></select><textarea name="reason" minLength={10} maxLength={1000} placeholder="Attributable reason" required /><button className="button button-secondary">Record contractor status</button></form>
    <form className="stack" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); void send(`/api/admin/quotes/${values.get("quoteId")}/economics-override`, { minimumContributionMarginCents: Number(values.get("margin")), reason: values.get("reason") }, "economics-override"); }}><strong>Quote economics override</strong><input name="quoteId" placeholder="Quote UUID" required /><input name="margin" type="number" min={-100000} max={1000000} placeholder="Minimum contribution cents" required /><textarea name="reason" minLength={10} maxLength={1000} placeholder="Attributable reason" required /><button className="button button-secondary">Record economics override</button></form>
    {message && <div className="fine-print field-full">{message}</div>}
  </div></section>;
}
