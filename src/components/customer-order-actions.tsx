"use client";

import { useState } from "react";

export function CustomerOrderActions({ orderId, status }: { orderId: string; status: string }) {
  const [message, setMessage] = useState<string>();
  if (!["SEARCHING_CONTRACTOR", "SCHEDULED"].includes(status)) return null;
  async function cancel() {
    const reason = window.prompt("Why are you cancelling this booking?");
    if (!reason || reason.trim().length < 5) return;
    const response = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `customer-cancel-${crypto.randomUUID()}` }, body: JSON.stringify({ reason }) });
    const data = await response.json() as { error?: { message?: string } };
    setMessage(response.ok ? "Cancellation recorded" : data.error?.message ?? "Cancellation failed");
  }
  return message ? <span className="fine-print">{message}</span> : <button className="button button-ghost" style={{ minHeight: 36, paddingInline: 10 }} onClick={cancel}>Cancel</button>;
}
