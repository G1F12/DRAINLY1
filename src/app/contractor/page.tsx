import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { OfferActions, JobActions } from "@/components/contractor-actions";
import { ProofUploader } from "@/components/proof-uploader";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { getServerEnv } from "@/lib/env";
import { getPaymentSystemDb } from "@/lib/system-db";
import { createSupabaseAuthClient, getAuthenticatedUser } from "@/lib/supabase/auth";
import { formatUsd } from "@/modules/pricing/money";

export const metadata: Metadata = { title: "Contractor dashboard" };
export const dynamic = "force-dynamic";

function demoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function demoOffers() {
  return [{ id: "92000000-0000-0000-0000-000000000001", order_id: "91000000-0000-0000-0000-000000000001", status: "OPEN", expires_at: new Date(Date.now() + 600_000).toISOString(), contractor_payout_cents: 35_550, requested_service_date: demoDate(1), timing_kind: "URGENT", tank_tier: "GAL_1000", county_name: "Johnston County", postal_code: "27577" }];
}

function demoJobs() {
  const requestedDate = demoDate(1);
  return [{ assignment_id: "demo-a", order_id: "91000000-0000-0000-0000-000000000002", public_ref: "DRN-DEMO-1038", status: "SCHEDULED", requested_service_date: requestedDate, service_window_start_at: `${requestedDate}T12:00:00Z`, access_type: "ATTENDED", tank_tier: "GAL_1250", address_snapshot: { city: "Clayton", countyName: "Johnston County" }, payment_status: "AUTHORIZED", contractor_payout_cents: 34_200 }];
}

async function contractorActionsEnabled(): Promise<boolean> {
  const env = getServerEnv();
  if (env.PROVIDER_MODE !== "real" || env.PILOT_MODE !== "sandbox") return false;
  const sql = getPaymentSystemDb();
  if (!sql) return false;
  try {
    const rows = await sql<{ readiness: { bookingExecutionEnabled?: boolean; paymentExecutionEnabled?: boolean; allowedPaymentMode?: string } }[]>`
      select api.pilot_readiness() as readiness
    `;
    const readiness = rows[0]?.readiness;
    return readiness?.bookingExecutionEnabled === true
      && readiness?.paymentExecutionEnabled === true
      && readiness?.allowedPaymentMode === "STRIPE_TEST";
  } catch {
    return false;
  }
}

export default async function ContractorPage() {
  const env = getServerEnv();
  const demoMode = env.AUTH_PROVIDER_MODE !== "real" && env.PROVIDER_MODE !== "real";

  if (demoMode) {
    const offers = demoOffers();
    const jobs = demoJobs();
    return <><SiteHeader /><main>
      <section className="page-hero"><div className="shell"><div className="eyebrow">Contractor demo</div><h1>Demo field board.</h1><p>All offers, jobs, payouts, authorization states, and dates shown here are simulated. Demo actions are disabled and do not call production contractor RPCs.</p></div></section>
      <section className="dashboard"><div className="shell"><div className="metric-grid"><div className="metric"><span className="metric-label">Open offers</span><strong className="metric-value">{offers.length}</strong></div><div className="metric"><span className="metric-label">Assigned jobs</span><strong className="metric-value">{jobs.length}</strong></div><div className="metric"><span className="metric-label">Expected payout</span><strong className="metric-value">{formatUsd(jobs.reduce((sum, job) => sum + job.contractor_payout_cents, 0))}</strong></div></div>
        <div className="stack"><section className="panel"><div className="panel-header"><h2>Outstanding offers</h2><StatusBadge status="OPEN" /></div><div className="list">{offers.map((offer) => <article className="list-row" key={offer.id}><div><div className="list-title">{offer.county_name} • {offer.postal_code}</div><div className="list-sub">{offer.tank_tier.replace("GAL_", "")} gal • {offer.timing_kind.toLowerCase()} • {offer.requested_service_date}</div></div><StatusBadge status={offer.status} /><div><div className="list-title">{formatUsd(offer.contractor_payout_cents)}</div><div className="list-sub">Expected payout</div></div><span className="status status-info">Demo only</span></article>)}</div></section>
        <section className="panel"><div className="panel-header"><h2>Assigned jobs</h2><span className="fine-print">Simulated authorization state</span></div><div className="list">{jobs.map((job) => <article className="list-row" key={job.assignment_id}><div><div className="list-title">{job.public_ref}</div><div className="list-sub">{String(job.address_snapshot.city)} • {job.requested_service_date}</div></div><StatusBadge status={job.status} /><div><StatusBadge status={job.payment_status} /><div className="list-sub">{formatUsd(job.contractor_payout_cents)} payout</div></div><span className="status status-info">Demo only</span></article>)}</div></section></div>
      </div></section>
    </main><SiteFooter /></>;
  }

  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in?next=/contractor");

  const client = await createSupabaseAuthClient();
  if (!client) return <AccessRestricted area="contractor dashboard" />;

  const actor = await client
    .from("current_contractor_context")
    .select("contractor_user_id, contractor_company_id, company_status, company_name")
    .maybeSingle();

  if (actor.error) return <AccessRestricted area="contractor dashboard" />;
  if (!actor.data) redirect("/contractor/onboarding");

  if (actor.data.company_status === "DISABLED") {
    return <><SiteHeader /><main><section className="page-hero"><div className="shell"><div className="eyebrow">Contractor account</div><h1>Account access is disabled.</h1><p>Contact Drainly support if you believe this status is incorrect.</p></div></section></main><SiteFooter /></>;
  }

  if (actor.data.company_status !== "APPROVED") {
    return <><SiteHeader /><main>
      <section className="page-hero"><div className="shell"><div className="eyebrow">Contractor account</div><h1>Your profile is under review.</h1><p>{actor.data.company_name ?? "Your contractor company"} is stored in Drainly. No demo offers or jobs are shown for real authenticated contractor accounts.</p></div></section>
      <section className="dashboard"><div className="shell"><section className="panel"><div className="panel-header"><div><h2>Account status</h2><p className="fine-print">Complete your profile, Stripe sandbox onboarding, and verification references. Drainly must approve the company before it can receive pilot offers.</p></div><StatusBadge status={actor.data.company_status ?? "PENDING"} /></div><div className="stack"><div><Link className="button button-primary" href="/contractor/onboarding">Continue contractor setup</Link></div><div className="fine-print">Real dispatch and payouts remain locked while the controlled pilot is off.</div></div></section></div></section>
    </main><SiteFooter /></>;
  }

  const [offerResult, jobResult, actionsEnabled] = await Promise.all([
    client.from("contractor_offers").select("*").eq("status", "OPEN").order("expires_at").limit(20),
    client.from("contractor_jobs").select("*").order("requested_service_date").limit(30),
    contractorActionsEnabled(),
  ]);

  if (offerResult.error || jobResult.error) return <AccessRestricted area="contractor dashboard" />;

  const offers = (offerResult.data ?? []).filter((offer): offer is typeof offer & { id: string; status: string; tank_tier: string; timing_kind: string; contractor_payout_cents: number } =>
    offer.id !== null && offer.status !== null && offer.tank_tier !== null && offer.timing_kind !== null && offer.contractor_payout_cents !== null,
  );
  const jobs = (jobResult.data ?? []).filter((job): job is typeof job & { assignment_id: string; order_id: string; status: string } =>
    job.assignment_id !== null && job.order_id !== null && job.status !== null,
  );

  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">Contractor operations</div><h1>Today’s field board.</h1><p>Only real offers and assignments belonging to your contractor company are shown here. Exact customer details become available only after your company wins the assignment.</p></div></section>
    <section className="dashboard"><div className="shell">
      {!actionsEnabled && <div className="success-box" style={{ marginBottom: 18 }}>Real contractor data is connected. Pilot actions are locked until Drainly explicitly opens the controlled sandbox pilot.</div>}
      <div className="metric-grid"><div className="metric"><span className="metric-label">Open offers</span><strong className="metric-value">{offers.length}</strong></div><div className="metric"><span className="metric-label">Assigned jobs</span><strong className="metric-value">{jobs.length}</strong></div><div className="metric"><span className="metric-label">Expected payout</span><strong className="metric-value">{formatUsd(jobs.reduce((sum, job) => sum + (job.contractor_payout_cents ?? 0), 0))}</strong></div></div>
      <div className="stack">
        <section className="panel"><div className="panel-header"><h2>Outstanding offers</h2><StatusBadge status="OPEN" /></div>{offers.length === 0 ? <div className="fine-print" style={{ padding: 16 }}>No real offers are available for your company right now.</div> : <div className="list">{offers.map((offer) => <article className="list-row" key={offer.id}><div><div className="list-title">{offer.county_name} • {offer.postal_code}</div><div className="list-sub">{offer.tank_tier.replace("GAL_", "")} gal • {offer.timing_kind.toLowerCase()} • {offer.requested_service_date}</div></div><StatusBadge status={offer.status} /><div><div className="list-title">{formatUsd(offer.contractor_payout_cents)}</div><div className="list-sub">Expected payout</div></div>{actionsEnabled ? <OfferActions offerId={offer.id} /> : <span className="status status-info">Pilot locked</span>}</article>)}</div>}</section>
        <section className="panel"><div className="panel-header"><h2>Assigned jobs</h2><span className="fine-print">{actionsEnabled ? "Authorization required before route start" : "Pilot actions locked"}</span></div>{jobs.length === 0 ? <div className="fine-print" style={{ padding: 16 }}>No real jobs are assigned to your company right now.</div> : <div className="list">{jobs.map((job) => <article className="list-row" key={job.assignment_id}><div><div className="list-title">{job.public_ref}</div><div className="list-sub">{String((job.address_snapshot as { city?: string }).city ?? "Assigned address")} • {job.requested_service_date}</div></div><StatusBadge status={job.status} /><div><StatusBadge status={job.payment_status ?? "REQUESTED"} /><div className="list-sub">{formatUsd(job.contractor_payout_cents ?? 0)} payout</div></div><div className="stack">{actionsEnabled ? <JobActions orderId={job.order_id} status={job.status} /> : <span className="status status-info">Pilot locked</span>}{actionsEnabled && job.status === "ARRIVED" && <ProofUploader orderId={job.order_id} />}</div></article>)}</div>}</section>
      </div>
    </div></section>
  </main><SiteFooter /></>;
}
