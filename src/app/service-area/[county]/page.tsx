import type { Metadata } from "next";
import { MapPinned, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";

import { GrowthLeadForm } from "@/components/growth-lead-form";
import { GrowthLink } from "@/components/growth-link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const counties = {
  "johnston-county-nc": {
    name: "Johnston County",
    code: "JOHNSTON_NC" as const,
    cities: "Smithfield, Clayton, Selma, Benson, Princeton, Kenly, and supported surrounding ZIP codes",
    title: "Septic Pumping Marketplace in Johnston County, NC",
    description: "Check Drainly pilot coverage and current septic pumping availability in supported Johnston County, North Carolina ZIP codes.",
  },
  "harnett-county-nc": {
    name: "Harnett County",
    code: "HARNETT_NC" as const,
    cities: "Lillington, Dunn, Angier, Coats, Erwin, Buies Creek, and supported surrounding ZIP codes",
    title: "Septic Pumping Marketplace in Harnett County, NC",
    description: "Check Drainly pilot coverage and current septic pumping availability in supported Harnett County, North Carolina ZIP codes.",
  },
} as const;

type CountySlug = keyof typeof counties;

export function generateStaticParams() {
  return Object.keys(counties).map((county) => ({ county }));
}

export async function generateMetadata({ params }: { params: Promise<{ county: string }> }): Promise<Metadata> {
  const { county } = await params;
  const data = counties[county as CountySlug];
  if (!data) return {};
  return {
    title: data.title,
    description: data.description,
    alternates: { canonical: `/service-area/${county}` },
    openGraph: { title: data.title, description: data.description, type: "website" },
  };
}

export default async function ServiceAreaPage({ params }: { params: Promise<{ county: string }> }) {
  const { county } = await params;
  const data = counties[county as CountySlug];
  if (!data) notFound();

  return <><SiteHeader /><main>
    <section className="hero"><div className="shell hero-grid">
      <div>
        <div className="eyebrow"><MapPinned size={16} /> Drainly pilot service area</div>
        <h1>Septic pumping coordination in {data.name}, North Carolina.</h1>
        <p className="hero-copy">Drainly checks address support, participating-contractor capacity, pricing, and marketplace economics before presenting a firm pilot quote.</p>
        <div className="trust-row"><span className="trust-item"><ShieldCheck size={17} color="var(--teal)" /> Firm price only when current supply is supported</span></div>
        <div style={{ marginTop: 28 }}><GrowthLink href="/#get-a-quote" className="button button-primary" audience="customer" placement="service_area">Check your address</GrowthLink></div>
      </div>
      <div className="quote-card">
        <h2>{data.name} pilot coverage</h2>
        <p>{data.cities}.</p>
        <p className="fine-print">Coverage is not a promise of immediate availability. Eligibility, contractor capacity, and pricing are checked for each request.</p>
        <GrowthLeadForm leadType="CUSTOMER_WAITLIST" source="SERVICE_AREA" countyCode={data.code} title="Want coverage updates?" />
      </div>
    </div></section>
    <section className="section section-white"><div className="shell"><div className="section-heading"><div className="eyebrow">How coverage works</div><h2>A local marketplace, not a directory listing.</h2><p>Drainly does not infer service availability from a ZIP code alone. A firm quote depends on supported geography plus eligible participating supply for the requested job.</p></div></div></section>
  </main><SiteFooter /></>;
}
