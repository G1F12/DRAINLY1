import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookingCheckout } from "@/components/booking-checkout";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complete booking" };
export const dynamic = "force-dynamic";
export default async function BookPage({ searchParams }: { searchParams: Promise<{ quote?: string }> }) {
  const { quote } = await searchParams; if (!quote) redirect("/#get-a-quote"); const user = await getCurrentUser();
  const demoMode = (process.env.PROVIDER_MODE ?? "fake").trim().toLowerCase() !== "real";
  if (!user && !demoMode) redirect(`/sign-in?next=${encodeURIComponent(`/book?quote=${quote}`)}`);
  return <><SiteHeader /><main><section className="page-hero"><div className="shell"><div className="eyebrow">{demoMode ? "Demo checkout" : "Secure checkout"}</div><h1>{demoMode ? "Run the demo booking flow." : "Finish your booking."}</h1><p>{demoMode ? "This environment uses simulated pricing, payment data, and contractor dispatch. No real booking or charge will be created." : "Confirm contact and payment permission. Your firm price is locked at booking; the requested service date is confirmed only after a local contractor accepts."}</p></div></section><section className="dashboard"><div className="shell dashboard-grid"><BookingCheckout quoteId={quote} email={user?.email ?? "demo.customer@example.test"} demo={demoMode} /><aside className="panel"><div className="panel-header"><h3>What happens next</h3></div><div className="panel-body timeline">{demoMode ? <><div className="timeline-item"><strong>Simulated quote</strong>No live contractor availability or price commitment is being represented.</div><div className="timeline-item"><strong>Simulated booking</strong>No real contractor is assigned or dispatched.</div><div className="timeline-item"><strong>No payment</strong>No real card is stored, authorized, or charged in demo mode.</div><div className="timeline-item"><strong>Production path</strong>Real booking behavior is enabled only when the provider mode is explicitly configured as real.</div></> : <><div className="timeline-item"><strong>Price locked</strong>Drainly starts controlled contractor dispatch for your requested date.</div><div className="timeline-item"><strong>One contractor accepts</strong>Your service date becomes confirmed only after atomic contractor acceptance.</div><div className="timeline-item"><strong>Authorization near service</strong>No contractor can start without the current authorization unless an admin records an override.</div><div className="timeline-item"><strong>Capture after completion</strong>Unattended jobs require private proof.</div></>}<Link href="/terms" className="fine-print">Cancellation and pilot terms</Link></div></aside></div></section></main><SiteFooter /></>;
}
