import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Clock3, DollarSign } from "lucide-react";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { AdminConfigurationCommands, AdminOrderActions } from "@/components/admin-command-center";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { getAdminContext } from "@/lib/admin-auth";
import { allowDemoFallback } from "@/lib/demo-boundary";
import { formatUsd } from "@/modules/pricing/money";

export const metadata: Metadata = {
  title: "Operations console",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const demoOrders = [
  {
    id: "demo-1",
    public_ref: "DRN-PILOT-1042",
    status: "SCHEDULED",
    requested_service_date: "2026-08-15",
    customer_total_cents: 36_500,
    contractor_company_id: "c1",
    contractor_name: "Johnston Septic",
    payment_status: "AUTHORIZATION_SCHEDULED",
    platform_gross_retained_cents: 5_500,
    stripe_processing_fee_cents: null,
    actual_platform_net_transaction_cents: null,
    updated_at: new Date().toISOString(),
    requires_admin_attention: false,
    failed_payment_operation: null,
  },
  {
    id: "demo-2",
    public_ref: "DRN-PILOT-1031",
    status: "FAILED_ACCESS",
    requested_service_date: "2026-08-11",
    customer_total_cents: 40_500,
    contractor_company_id: "c2",
    contractor_name: "Cross County Septic",
    payment_status: "CANCELLED",
    platform_gross_retained_cents: 6_500,
    stripe_processing_fee_cents: null,
    actual_platform_net_transaction_cents: null,
    updated_at: new Date().toISOString(),
    requires_admin_attention: false,
    failed_payment_operation: null,
  },
];

export default async function AdminPage() {
  const demoMode = allowDemoFallback();
  const admin = demoMode ? null : await getAdminContext();

  if (!demoMode && !admin?.user) redirect("/sign-in?next=/admin");
  if (!demoMode && (!admin?.isAdmin || !admin.client)) {
    return <AccessRestricted area="operations console" />;
  }

  const result = !demoMode && admin?.client
    ? await admin.client
        .from("admin_order_overview")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(50)
    : { data: null };

  const orderRows = demoMode ? demoOrders : (result.data ?? []);
  const orders = orderRows.filter(
    (order): order is typeof order & { id: string; status: string; customer_total_cents: number } =>
      order.id !== null && order.status !== null && order.customer_total_cents !== null,
  );
  const exceptions = orders.filter(
    (order) => ["FAILED_ACCESS", "FAILED_SERVICE", "NEEDS_ADMIN_REVIEW"].includes(order.status)
      || order.requires_admin_attention,
  ).length;

  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell">
      <div className="eyebrow">Drainly operations</div>
      <h1>Pilot control room.</h1>
      <p>Operational exceptions, assignment, payment state, and historical economics are visible without rewriting the underlying audit trail.</p>
    </div></section>
    <section className="dashboard"><div className="shell">
      <div className="metric-grid">
        <div className="metric">
          <span className="metric-label"><Clock3 size={14} /> Active orders</span>
          <strong className="metric-value">{orders.filter((order) => !["CLOSED", "CANCELLED"].includes(order.status)).length}</strong>
        </div>
        <div className="metric">
          <span className="metric-label"><AlertTriangle size={14} /> Exceptions</span>
          <strong className="metric-value">{exceptions}</strong>
        </div>
        <div className="metric">
          <span className="metric-label"><DollarSign size={14} /> Customer volume</span>
          <strong className="metric-value">{formatUsd(orders.reduce((sum, order) => sum + order.customer_total_cents, 0))}</strong>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Order operations</h2>
          <span className="status status-good"><CheckCircle2 size={13} /> Audit recording on</span>
        </div>
        <div className="list">
          {orders.map((order) => <article className="list-row" key={order.id}>
            <div>
              <div className="list-title">{order.public_ref}</div>
              <div className="list-sub">{order.contractor_name ?? "Searching for contractor"} вЂў {order.requested_service_date}</div>
            </div>
            <StatusBadge status={order.status} />
            <div>
              <div className="list-title">{formatUsd(order.customer_total_cents)}</div>
              <div className="list-sub">Retained before costs: {formatUsd(order.platform_gross_retained_cents ?? 0)}</div>
            </div>
            <StatusBadge status={order.payment_status ?? "NOT_READY"} />
            <AdminOrderActions orderId={order.id} customerTotalCents={order.customer_total_cents} />
          </article>)}
        </div>
      </section>

      {orders.some((order) => order.requires_admin_attention)
        && <div className="form-error" role="alert">
          One or more orders require audited payment-operation recovery. The physical service status above remains authoritative.
        </div>}

      {orders.filter((order) => order.requires_admin_attention).map((order) =>
        <div className="callout" key={`recovery-${order.id}`}>
          <div>
            <strong>{order.public_ref}: {order.failed_payment_operation}</strong>
            <p>Automatic retries are exhausted. Review provider state before retrying.</p>
          </div>
          <AdminOrderActions
            orderId={order.id}
            customerTotalCents={order.customer_total_cents}
            failedPaymentOperation={order.failed_payment_operation}
          />
        </div>)}

      <AdminConfigurationCommands />

      <div className="callout" style={{ marginTop: 22, background: "#fff", color: "var(--ink)", border: "1px solid var(--line)" }}>
        <div>
          <h2 style={{ fontSize: "1.5rem" }}>Dangerous actions stay explicit.</h2>
          <p style={{ color: "var(--muted)" }}>
            Reassignment, authorization override, cancellation, and refunds require confirmed commands, reason text,
            active admin status, MFA, and immutable audit entries.
          </p>
        </div>
        <StatusBadge status="MFA REQUIRED" />
      </div>
    </div></section>
  </main><SiteFooter /></>;
}