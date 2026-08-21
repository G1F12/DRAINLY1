import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { CustomerGrowthPanel, type CustomerGrowthBundle } from "@/components/customer-growth-panel";
import { CustomerOrderActions } from "@/components/customer-order-actions";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { getServerEnv } from "@/lib/env";
import { getGrowthSystemDb } from "@/lib/system-db";
import { createSupabaseAuthClient, getAuthenticatedUser } from "@/lib/supabase/auth";
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
  return [{ id: "demo", public_ref: "DRN-DEMO-1042", status: "SCHEDULED", requested_service_date: demoDate(1), customer_total_cents: 36_500, payment_status: "AUTHORIZATION_SCHEDULED", address_snapshot: { countyName: "Johnston County" } }];
}

export default async function CustomerPage() {
  const env = getServerEnv();
  const demoMode = env.AUTH_PROVIDER_MODE !== "real" && env.PROVIDER_MODE !== "real";

  if (demoMode) {
    const orders = demoOrders();
    const latestService = customerServiceMessage(orders[0]!.status);
    return <><SiteHeader /><main><section className="page-hero"><div className="shell"><div className="eyebrow">Customer demo</div><h1>Demo bookings.</h1><p>All bookings, prices, payment states, and service activity shown here are simulated. Demo actions do not write to the live marketplace database.</p></div></section><section className="dashboard"><div className="shell"><div className="metric-grid"><div className="metric"><span className="metric-label">Active bookings</span><strong className="metric-value">1</strong></div><div className="metric"><span className="metric-label">Completed jobs</span><strong className="metric-value">0</strong></div><div className="metric"><span className="metric-label">Pilot counties</span><strong className="metric-value">2</strong></div></div><div className="dashboard-grid"><section className="panel"><div className="panel-header"><h2>Demo bookings</h2><Link className="button button-secondary" href="/#get-a-quote">New booking</Link></div><div className="list">{orders.map((order) => <article className="list-row" key={order.id}><div><div className="list-title">{order.public_ref}</div><div className="list-sub">Johnston County • {order.requested_service_date}</div></div><StatusBadge status={order.status} /><div><div className="list-title">{formatUsd(order.customer_total_cents)}</div><div className="list-sub">Customer total</div></div><StatusBadge status={order.payment_status} /><span className="status status-info">Demo only</span></article>)}</div></section><aside className="panel"><div className="panel-header"><h3>Latest activity</h3></div><div className="panel-body timeline"><div className="timeline-item"><strong>{latestService.heading}</strong>{latestService.detail}</div><div className="timeline-item"><strong>Simulated payment state</strong>No real card is stored, authorized, or charged in demo mode.</div></div></aside></div></div></section></main><SiteFooter /></>;
  }

  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in?next=/customer");
  const client = await createSupabaseAuthClient();
  if (!client) return <AccessRestricted area="customer bookings" />;
  const actor = await client.from("current_customer_context").select("customer_id").maybeSingle();
  if (actor.error) return <AccessRestricted area="customer bookings" />;

  const orderResult = actor.data
    ? await client.from("customer_orders").select("*").order("created_at", { ascending: false }).limit(25)
    : { data: [], error: null };
  if (orderResult.error) return <AccessRestricted area="customer bookings" />;

  const orders = (orderResult.data ?? []).flatMap((order) => {
    const id = order.id;
    const status = order.status;
    const customerTotalCents = order.customer_total_cents;
    if (id === null || status === null || customerTotalCents === null) return [];
    return [{
      ...order,
      id,
      status,
      customer_total_cents: customerTotalCents,
    }];
  });
  const latestService = orders[0] ? customerServiceMessage(orders[0].status) : null;
  const sql = getGrowthSystemDb();
  let growth: CustomerGrowthBundle = { customerExists: Boolean(actor.data), annualServiceCheckin: false, referralEligible: false, referralCode: null };
  if (sql) {
    try {
      const rows = await sql<{ bundle: CustomerGrowthBundle }[]>`select internal.get_customer_growth_bundle(${user.id}::uuid) as bundle`;
      if (rows[0]?.bundle) growth = rows[0].bundle;
    } catch {
      // Customer dashboard remains usable if optional growth data is unavailable.
    }
  }

  const actionsEnabled = env.PROVIDER_MODE === "real";
  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">Customer bookings</div><h1>Your Drainly account.</h1><p>Track real bookings associated with this signed-in account. Growth reminders and referrals are optional.</p></div></section>
    <section className="dashboard"><div className="shell stack">
      {!actionsEnabled && <div className="success-box">Real account reads are connected. Marketplace write actions remain locked while the controlled pilot is closed.</div>}
      <div className="metric-grid"><div className="metric"><span className="metric-label">Active bookings</span><strong className="metric-value">{orders.filter((order) => !["CLOSED", "CANCELLED"].includes(order.status)).length}</strong></div><div className="metric"><span className="metric-label">Completed jobs</span><strong className="metric-value">{orders.filter((order) => order.status === "CLOSED").length}</strong></div><div className="metric"><span className="metric-label">Pilot counties</span><strong className="metric-value">2</strong></div></div>
      <div className="dashboard-grid"><section className="panel"><div className="panel-header"><h2>Your bookings</h2><Link className="button button-secondary" href="/#get-a-quote">New booking</Link></div>{orders.length === 0 ? <div className="panel-body fine-print">No real Drainly bookings are associated with this account yet.</div> : <div className="list">{orders.map((order) => <article className="list-row" key={order.id}><div><div className="list-title">{order.public_ref}</div><div className="list-sub">{String((order.address_snapshot as { countyName?: string })?.countyName ?? "Pilot service area")} • {order.requested_service_date}</div></div><StatusBadge status={order.status} /><div><div className="list-title">{formatUsd(order.customer_total_cents)}</div><div className="list-sub">Customer total</div></div><StatusBadge status={order.payment_status ?? "METHOD_READY"} />{actionsEnabled ? <CustomerOrderActions orderId={order.id} status={order.status} /> : <span className="status status-info">Pilot locked</span>}</article>)}</div>}</section>
      <aside className="panel"><div className="panel-header"><h3>Latest activity</h3></div><div className="panel-body timeline">{latestService ? <div className="timeline-item"><strong>{latestService.heading}</strong>{latestService.detail}</div> : <div className="timeline-item"><strong>No service activity yet</strong>Start with an address check when you are ready.</div>}<div className="timeline-item"><strong>Payment boundary</strong>Live money remains disabled until Drainly explicitly opens the controlled pilot.</div></div></aside></div>
      <CustomerGrowthPanel initial={growth} />
    </div></section>
  </main><SiteFooter /></>;
}
