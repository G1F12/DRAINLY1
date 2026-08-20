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
  if (!user && process.env.PROVIDER_MODE === "real") redirect(`/sign-in?next=${encodeURIComponent(`/book?quote=${quote}`)}`);
  return <><SiteHeader /><main><section className="page-hero"><div className="shell"><div className="eyebrow">Secure checkout</div><h1>Finish your booking.</h1><p>Confirm contact and payment permission. Your firm price is locked at booking; the requested service date is confirmed only after a local contractor accepts.</p></div></section><section className="dashboard"><div className="shell dashboard-grid"><BookingCheckout quoteId={quote} email={user?.email ?? "demo.customer@example.test"} /><aside className="panel"><div className="panel-header"><h3>What happens next</h3></div><div className="panel-body timeline"><div className="timeline-item"><strong>Price locked</strong>Drainly starts controlled contractor dispatch for your requested date.</div><div className="timeline-item"><strong>One contractor accepts</strong>Your service date becomes confirmed only after atomic contractor acceptance.</div><div className="timeline-item"><strong>Authorization near service</strong>No contractor can start without the current authorization unless an admin records an override.</div><div className="timeline-item"><strong>Capture after completion</strong>Unattended jobs require private proof.</div><Link href="/terms" className="fine-print">Cancellation and pilot terms</Link></div></aside></div></section></main><SiteFooter /></>;
}
