import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { GrowthExperimentForm } from "@/components/growth-experiment-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { getGrowthSystemDb } from "@/lib/system-db";
import { createSupabaseAuthClient, getAuthenticatedUser } from "@/lib/supabase/auth";
import { formatUsd } from "@/modules/pricing/money";

export const metadata: Metadata = { title: "Growth scorecard" };
export const dynamic = "force-dynamic";

type Dashboard = {
  quotes7d: number; quotesPrevious7d: number; quotes30d: number; pricedQuotes30d: number; convertedQuotes30d: number;
  quoteConversionRate30d: number; orders30d: number; closedOrders30d: number; cancelledOrders30d: number;
  customerVolumeCents30d: number; customerLeads30d: number; contractorLeads30d: number; referralVisits30d: number;
  referralConversions30d: number; activeReferralCodes: number; annualCheckinOptIns: number; contractorCount: number;
  approvedContractorCount: number; connectReadyContractorCount: number; runningExperiments: number;
};

type Experiment = { experimentKey: string; hypothesis: string; guardrail: string; status: string; updatedAt?: string };

export default async function GrowthPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in?next=/admin/growth");
  const client = await createSupabaseAuthClient();
  if (!client) return <AccessRestricted area="growth scorecard" />;
  const actor = await client.from("current_admin_context").select("admin_id").maybeSingle();
  if (actor.error || !actor.data) return <AccessRestricted area="growth scorecard" />;

  const sql = getGrowthSystemDb();
  if (!sql) return <AccessRestricted area="growth scorecard" />;
  const [dashboardRows, experimentRows] = await Promise.all([
    sql<{ dashboard: Dashboard }[]>`select internal.growth_dashboard() as dashboard`,
    sql<{ experiments: Experiment[] }[]>`select internal.growth_experiments_snapshot() as experiments`,
  ]);
  const dashboard = dashboardRows[0]?.dashboard;
  const experiments = experimentRows[0]?.experiments ?? [];
  if (!dashboard) return <AccessRestricted area="growth scorecard" />;

  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">Stage 6 growth operations</div><h1>Growth scorecard.</h1><p>Aggregated marketplace acquisition, conversion, retention, referral, and contractor-supply signals. No customer addresses or identities are exposed here.</p><div style={{ marginTop: 18 }}><Link className="button button-secondary" href="/admin">Back to operations</Link></div></div></section>
    <section className="dashboard"><div className="shell stack">
      <div className="metric-grid"><div className="metric"><span className="metric-label">Quotes · 7d</span><strong className="metric-value">{dashboard.quotes7d}</strong><span className="fine-print">Previous 7d: {dashboard.quotesPrevious7d}</span></div><div className="metric"><span className="metric-label">Quote conversion · 30d</span><strong className="metric-value">{dashboard.quoteConversionRate30d}%</strong><span className="fine-print">{dashboard.convertedQuotes30d} / {dashboard.quotes30d}</span></div><div className="metric"><span className="metric-label">Customer volume · 30d</span><strong className="metric-value">{formatUsd(dashboard.customerVolumeCents30d)}</strong><span className="fine-print">Orders: {dashboard.orders30d}</span></div></div>
      <div className="metric-grid"><div className="metric"><span className="metric-label">Customer leads · 30d</span><strong className="metric-value">{dashboard.customerLeads30d}</strong></div><div className="metric"><span className="metric-label">Contractor leads · 30d</span><strong className="metric-value">{dashboard.contractorLeads30d}</strong></div><div className="metric"><span className="metric-label">Referral visits · 30d</span><strong className="metric-value">{dashboard.referralVisits30d}</strong><span className="fine-print">Attributed quotes: {dashboard.referralConversions30d}</span></div></div>
      <section className="panel"><div className="panel-header"><div><h2>Supply & retention</h2><p className="fine-print">Growth does not override contractor approval or pilot-payment gates.</p></div></div><div className="panel-body timeline"><div className="timeline-item"><strong>Contractor supply</strong>{dashboard.approvedContractorCount} approved / {dashboard.contractorCount} total; {dashboard.connectReadyContractorCount} Stripe-transfer ready.</div><div className="timeline-item"><strong>Annual check-ins</strong>{dashboard.annualCheckinOptIns} opted-in customer profiles.</div><div className="timeline-item"><strong>Order outcomes · 30d</strong>{dashboard.closedOrders30d} closed, {dashboard.cancelledOrders30d} cancelled.</div></div></section>
      <section className="panel"><div className="panel-header"><div><h2>Experiment registry</h2><p className="fine-print">Experiments record a hypothesis and explicit guardrail; they do not automatically change pricing, dispatch, or payment behavior.</p></div><StatusBadge status={`${dashboard.runningExperiments} RUNNING`} /></div><div className="panel-body stack"><GrowthExperimentForm />{experiments.length === 0 ? <div className="fine-print">No experiments registered yet.</div> : <div className="list">{experiments.map((experiment) => <article className="list-row" key={experiment.experimentKey}><div><div className="list-title">{experiment.experimentKey}</div><div className="list-sub">{experiment.hypothesis}</div></div><StatusBadge status={experiment.status} /><div className="fine-print">Guardrail: {experiment.guardrail}</div></article>)}</div>}</div></section>
    </div></section>
  </main><SiteFooter /></>;
}
