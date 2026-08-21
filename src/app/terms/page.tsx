import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Pilot terms" };

export default function TermsPage() {
  return <><SiteHeader /><main className="section"><article className="shell" style={{ maxWidth: 760 }}>
    <div className="eyebrow">Pilot policy</div><h1 style={{ fontFamily: "Georgia,serif", fontSize: "3rem" }}>Marketplace terms</h1>
    <p>Drainly coordinates bookings with participating independent septic contractors. Drainly does not perform septic pumping services.</p>
    <h2>Quotes and availability</h2><p>A firm quote is shown only when current rules and eligible contractor supply support it. A quote is not a guaranteed appointment; eligibility and capacity are checked again at booking, dispatch, and acceptance.</p>
    <h2>Payment timing</h2><p>You authorize Drainly to save a payment method for one booking, authorize the displayed total near service, and capture after valid completion. Unattended completion requires private proof. Failed access and unusual conditions may require admin review.</p>
    <h2>Cancellations and refunds</h2><p>Pilot cancellation and failed-access decisions are reviewed against job state and documented operating policy. Refunds are limited to captured funds and recorded with transfer-reversal results.</p>
    <h2>Growth features</h2><p>Pilot-update forms require explicit email consent. Referral links are attribution tools only and do not create a discount, credit, cash payment, or other reward unless Drainly separately publishes specific program terms.</p>
    <h2>Production gate</h2><p>These pilot terms are implementation placeholders and require legal approval before real customer activation.</p>
  </article></main><SiteFooter /></>;
}
