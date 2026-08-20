import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function AccessRestricted({ area }: { area: string }) {
  return <><SiteHeader /><main><section className="page-hero"><div className="shell">
    <div className="eyebrow">Access restricted</div>
    <h1>This account cannot open the {area}.</h1>
    <p>Drainly verifies active role membership on the server and through PostgreSQL row-level security. Contact pilot operations if your invitation or status is incorrect.</p>
    <Link className="button button-primary" href="/">Return home</Link>
  </div></section></main><SiteFooter /></>;
}
