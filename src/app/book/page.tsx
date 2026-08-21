import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BookingCheckout } from "@/components/booking-checkout";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complete booking" };
export const dynamic = "force-dynamic";

type CheckoutMode = "demo" | "stripe_test" | "live";

export default async function BookPage({ searchParams }: { searchParams: Promise<{ quote?: string }> }) {
  const { quote } = await searchParams;
  if (!quote) redirect("/#get-a-quote");

  const user = await getCurrentUser();
  const coreReal = (process.env.PROVIDER_MODE ?? "fake").trim().toLowerCase() === "real";
  const stripeTest = (process.env.PAYMENT_PROVIDER_MODE ?? "fake").trim().toLowerCase() === "stripe_test";
  const mode: CheckoutMode = coreReal ? "live" : stripeTest ? "stripe_test" : "demo";

  if (!user && mode !== "demo") {
    redirect(`/sign-in?next=${encodeURIComponent(`/book?quote=${quote}`)}`);
  }

  const hero = mode === "demo"
    ? {
        eyebrow: "Demo checkout",
        title: "Run the demo booking flow.",
        copy: "This environment uses simulated pricing, payment data, and contractor dispatch. No real booking or charge will be created.",
      }
    : mode === "stripe_test"
      ? {
          eyebrow: "Stripe test checkout",
          title: "Verify the card setup flow.",
          copy: "Stripe test mode may save a test payment method. Drainly will not create an order, dispatch a contractor, authorize a payment, capture funds, or make a live charge.",
        }
      : {
          eyebrow: "Secure checkout",
          title: "Finish your booking.",
          copy: "Confirm contact and payment permission. Your firm price is locked at booking; the requested service date is confirmed only after a local contractor accepts.",
        };

  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell">
      <div className="eyebrow">{hero.eyebrow}</div>
      <h1>{hero.title}</h1>
      <p>{hero.copy}</p>
    </div></section>
    <section className="dashboard"><div className="shell dashboard-grid">
      <BookingCheckout
        quoteId={quote}
        email={user?.email ?? "demo.customer@example.test"}
        mode={mode}
      />
      <aside className="panel">
        <div className="panel-header"><h3>What happens next</h3></div>
        <div className="panel-body timeline">
          {mode === "demo" ? <>
            <div className="timeline-item"><strong>Simulated quote</strong>No live contractor availability or price commitment is being represented.</div>
            <div className="timeline-item"><strong>Simulated booking</strong>No real contractor is assigned or dispatched.</div>
            <div className="timeline-item"><strong>No payment</strong>No real card is stored, authorized, or charged in demo mode.</div>
            <div className="timeline-item"><strong>Production path</strong>Real booking behavior is enabled only when the provider mode is explicitly configured as real.</div>
          </> : mode === "stripe_test" ? <>
            <div className="timeline-item"><strong>Stripe test data only</strong>Use Stripe test payment methods. Live cards and live money are not accepted by this application.</div>
            <div className="timeline-item"><strong>SetupIntent only</strong>The test verifies reusable-card setup and webhook signature handling.</div>
            <div className="timeline-item"><strong>No booking</strong>No Drainly order, offer, assignment, or contractor dispatch is created.</div>
            <div className="timeline-item"><strong>No charge</strong>No authorization or capture is requested in this test boundary.</div>
          </> : <>
            <div className="timeline-item"><strong>Price locked</strong>Drainly starts controlled contractor dispatch for your requested date.</div>
            <div className="timeline-item"><strong>One contractor accepts</strong>Your service date becomes confirmed only after atomic contractor acceptance.</div>
            <div className="timeline-item"><strong>Authorization near service</strong>No contractor can start without the current authorization unless an admin records an override.</div>
            <div className="timeline-item"><strong>Capture after completion</strong>Unattended jobs require private proof.</div>
          </>}
          <Link href="/terms" className="fine-print">Cancellation and pilot terms</Link>
        </div>
      </aside>
    </div></section>
  </main><SiteFooter /></>;
}
