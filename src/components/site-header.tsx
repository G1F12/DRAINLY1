import { Droplets } from "lucide-react";
import Link from "next/link";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Drainly home"><span className="brand-mark"><Droplets size={20} aria-hidden /></span><span>Drainly</span></Link>;
}

export function SiteHeader() {
  return <header className="site-header"><div className="shell header-row"><Brand /><nav className="nav" aria-label="Main navigation"><span className="mobile-hide"><Link href="/#how-it-works">How it works</Link></span><span className="mobile-hide"><Link href="/contractors">For contractors</Link></span><Link href="/sign-in">Sign in</Link><Link className="button button-primary" href="/#get-a-quote">Get a quote</Link></nav></div></header>;
}
