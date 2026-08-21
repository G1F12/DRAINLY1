import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return <><SiteHeader /><main className="section"><article className="shell" style={{ maxWidth: 760 }}>
    <div className="eyebrow">Pilot policy</div><h1 style={{ fontFamily: "Georgia,serif", fontSize: "3rem" }}>Privacy</h1>
    <p>Drainly stores the contact, property, service, assignment, payment-reference, and audit information needed to operate the marketplace. Card data is handled by Stripe and is not stored by Drainly.</p>
    <h2>Growth and analytics</h2><p>Drainly growth analytics are deliberately non-identifying: funnel events do not include entered addresses, ZIP codes, customer names, email addresses, phone numbers, free-text notes, quote/order/referral identifiers, or URL query strings. If you explicitly submit an email for pilot updates, Drainly stores that email and the limited context needed to honor that request.</p>
    <h2>Referrals and reminders</h2><p>Referral links record an aggregate visit and, when a real quote is created, may associate that quote with the referral code. Drainly does not add device fingerprinting to referral tracking. Annual service check-ins are optional and can be disabled in the customer dashboard.</p>
    <h2>Completion proof</h2><p>Job proof is private. Access is limited to the booking customer, assigned contractor company, and authorized Drainly operations staff through short-lived authorized links.</p>
    <h2>Service providers</h2><p>Configured providers may process address validation, payments, transactional messages, analytics, error reports, and storage. Production activation requires finalized retention, consent, and provider agreements.</p>
    <h2>Contact</h2><p>Privacy requests: privacy@drainly.us.</p>
  </article></main><SiteFooter /></>;
}
