import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { CustomerOrderActions } from "@/components/customer-order-actions";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { getServerEnv } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { customerServiceMessage } from "@/modules/orders/customer-presentation";
import { formatUsd } from "@/modules/pricing/money";

export const metadata: Metadata = { title: "My bookings" };
export const dynamic = "force-dynamic";

function demoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function demoOrders() {
  return [{
    id: "demo",
    public_ref: "DRN-DEMO-1042",
    status: "SCHEDULED",
    requested_service_date: demoDate(1),
    customer_total_cents: 36_500,
    payment_status: "AUTHORIZATION_SCHEDULED",
    address_snapshot: { countyName: "Johnston County" },
  }];
}

export default async function CustomerPage() {
  const user = await getCurrentUser();
  const client = await createSupabaseServerClient();
  const demoMode = getServerEnv().PROVIDER_MODE !== "real";
  if (!demoMode && !user) redirect("/sign-in?next=/customer");
  const actor = client && user ? await client.from("current_customer_context").select("customer_id").maybeSingle() : { data: null };
  if (!demoMode && !actor.data) return <AccessRestricted area="customer bookings" />;
  const { data } = client && user && actor.data ? await client.from("customer_orders").select("*").order("created_at", { ascending: false }).limit(25) : { data: null };
  const orderRows = demoMode ? demoOrders() : (data ?? []);
  const orders = orderRows.filter((order): order is typeof order & { id: string; status: string; customer_total_cents: number } =>
    order.id !== null && order.status !== null && order.customer_total_cents !== null,
  );
  const latestService = orders[0] ? customerServiceMessage(orders[0].status) : null;
  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">{demoMode ? "Customer demo" : "Customer bookings"}</div><h1>{demoMode ? "Demo bookings." : `Good morning${user?.email ? `, ${user.email.split("@")[0]}` : ""}.`}</h1><p>{demoMode ? "All bookings, prices, payment states, and service activity shown here are simulated. Demo actions do not write to the live marketplace database." : "Track assignments, service progress, payment status, and completion proof."}</p></div></section>
    <section className="dashboard"><div className="shell"><div className="metric-grid"><div className="metric"><span className="metric-label">Active bookings</span><strong className="metric-value">{orders.filter((order) => !["CLOSED", "CANCELLED"].includes(order.status)).length}</strong></div><div className="metric"><span className="metric-label">Completed jobs</span><strong className="metric-value">{orders.filter((order) => order.status === "CLOSED").length}</strong></div><div className="metric"><span className="metric-label">Pilot counties</span><strong className="metric-value">2</strong></div></div>
      <div className="dashboard-grid"><section className="panel"><div className="panel-header"><h2>{demoMode ? "Demo bookings" : "Your bookings"}</h2><Link className="button button-secondary" href="/#get-a-quote">New booking</Link></div><div className="list">{orders.map((order) => <article className="list-row" key={order.id}><div><div className="list-title">{order.public_ref}</div><div className="list-sub">{String((order.address_snapshot as { countyName?: string })?.countyName ?? "Pilot service area")} • {order.requested_service_date}</div></div><StatusBadge status={order.status} /><div><div className="list-title">{formatUsd(order.customer_total_cents)}</div><div className="list-sub">Customer total</div></div><StatusBadge status={order.payment_status ?? "METHOD_READY"} />{demoMode ? <span className="status status-info">Demo only</span> : <CustomerOrderActions orderId={order.id} status={order.status} />}</article>)}</div></section>
      <aside className="panel"><div className="panel-header"><h3>Latest activity</h3></div><div className="panel-body timeline">{latestService && <div className="timeline-item"><strong>{latestService.heading}</strong>{latestService.detail}</div>}<div className="timeline-item"><strong>{demoMode ? "Simulated payment state" : "Payment method ready"}</strong>{demoMode ? "No real card is stored, authorized, or charged in demo mode." : "Authorization will be attempted close to service after a contractor accepts."}</div><div className="timeline-item"><strong>{demoMode ? "Simulated price" : "Price locked"}</strong>{demoMode ? "The displayed amount is demo data and is not a service commitment." : "Quote and service details were snapshotted; requested-date capacity is not reserved before contractor acceptance."}</div></div></aside></div>
    </div></section>
  </main><SiteFooter /></>;
}
