import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContractorOnboardingForm } from "@/components/contractor-onboarding-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contractor onboarding" };
export const dynamic = "force-dynamic";

export default async function ContractorOnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/contractor/onboarding");

  return <><SiteHeader /><main>
    <section className="page-hero"><div className="shell"><div className="eyebrow">Contractor onboarding</div><h1>Set up your real contractor profile.</h1><p>Company details, service area, capacity, and your own pumping prices are stored in Drainly. This does not enable live dispatch or payments.</p></div></section>
    <section className="dashboard"><div className="shell"><ContractorOnboardingForm /></div></section>
  </main><SiteFooter /></>;
}
