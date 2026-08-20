import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccessRestricted } from "@/components/access-restricted";
import { OfferActions, JobActions } from "@/components/contractor-actions";
import { ProofUploader } from "@/components/proof-uploader";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { formatUsd } from "@/modules/pricing/money";

export const metadata: Metadata = { title: "Contractor dashboard" };
export const dynamic = "force-dynamic";
const demoOffers = [{ id: "92000000-0000-0000-0000-000000000001", order_id: "91000000-0000-0000-0000-000000000001", status: "OPEN", expires_at: new Date(Date.now() + 600_000).toISOString(), contractor_payout_cents: 35_550, requested_service_date: "2026-08-15", timing_kind: "URGENT", tank_tier: "GAL_1000", county_name: "Johnston County", postal_code: "27577" }];
const demoJobs = [{ assignment_id: "demo-a", order_id: "91000000-0000-0000-0000-000000000002", public_ref: "DRN-PILOT-1038", status: "SCHEDULED", requested_service_date: "2026-08-15", service_window_start_at: "2026-08-15T12:00:00Z", access_type: "ATTENDED", tank_tier: "GAL_1250", address_snapshot: { city: "Clayton", countyName: "Johnston County" }, payment_status: "AUTHORIZED", contractor_payout_cents: 34_200 }];

export default async function ContractorPage() {
  const user = await getCurrentUser();
  const client = await createSupabaseServerClient();
  const demoMode = getServerEnv().PROVIDER_MODE !== "real";
  if (!demoMode && !user) redirect("/sign-in?next=/contractor");
  const actor = client && user ? await client.from("current_contractor_context").select("contractor_user_id").maybeSingle() : { data: null };
  if (!demoMode && !actor.data) return <AccessRestricted area="contractor dashboard" />;
  const offerResult = client && user && actor.data ? await client.from("contractor_offers").select("*").eq("status", "OPEN").order("expires_at").limit(20) : { data: null };
  const jobResult = client && user && actor.data ? await client.from("contractor_jobs").select("*").order("requested_service_date").limit(30) : { data: null };
  const offerRows = demoMode ? (offerResult.data?.length ? offerResult.data : demoOffers) : (offerResult.data ?? []);
  const jobRows = demoMode ? (jobResult.data?.length ? jobResult.data : demoJobs) : (jobResult.data ?? []);
  const offers = offerRows.filter((offer): offer is typeof offer & { id: string; status: string; tank_tier: string; timing_kind: string; contractor_payout_cents: number } =>
    offer.id !== null && offer.status !== null && offer.tank_tier !== null && offer.timing_kind !== null && offer.contractor_payout_cents !== null,
  );
  const jobs = jobRows.filter((job): job is typeof job & { assignment_id: string; order_id: string; status: string } =>
    job.assignment_id !== null && job.order_id !== null && job.status !== null,
  );
  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">Contractor operations</div><h1>Today&apos;s field board.</h1><p>Outstanding offers are intentionally limited. Exact customer details become available only after your company wins the assignment.</p></div></section>
    <section className="dashboard"><div className="shell"><div className="metric-grid"><div className="metric"><span className="metric-label">Open offers</span><strong className="metric-value">{offers.length}</strong></div><div className="metric"><span className="metric-label">Assigned jobs</span><strong className="metric-value">{jobs.length}</strong></div><div className="metric"><span className="metric-label">Expected payout</span><strong className="metric-value">{formatUsd(jobs.reduce((sum, job) => sum + (job.contractor_payout_cents ?? 0), 0))}</strong></div></div>
      <div className="stack"><section className="panel"><div className="panel-header"><h2>Outstanding offers</h2><StatusBadge status="OPEN" /></div><div className="list">{offers.map((offer) => <article className="list-row" key={offer.id}><div><div className="list-title">{offer.county_name} • {offer.postal_code}</div><div className="list-sub">{offer.tank_tier.replace("GAL_", "")} gal • {offer.timing_kind.toLowerCase()} • {offer.requested_service_date}</div></div><StatusBadge status={offer.status} /><div><div className="list-title">{formatUsd(offer.contractor_payout_cents)}</div><div className="list-sub">Expected payout</div></div><OfferActions offerId={offer.id} /></article>)}</div></section>
      <section className="panel"><div className="panel-header"><h2>Assigned jobs</h2><span className="fine-print">Authorization required before route start</span></div><div className="list">{jobs.map((job) => <article className="list-row" key={job.assignment_id}><div><div className="list-title">{job.public_ref}</div><div className="list-sub">{String((job.address_snapshot as { city?: string }).city ?? "Assigned address")} • {job.requested_service_date}</div></div><StatusBadge status={job.status} /><div><StatusBadge status={job.payment_status ?? "REQUESTED"} /><div className="list-sub">{formatUsd(job.contractor_payout_cents ?? 0)} payout</div></div><div className="stack"><JobActions orderId={job.order_id} status={job.status} />{job.status === "ARRIVED" && <ProofUploader orderId={job.order_id} />}</div></article>)}</div></section></div>
    </div></section>
  </main><SiteFooter /></>;
}
