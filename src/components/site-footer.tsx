import Link from "next/link";
import { Brand } from "@/components/site-header";

export function SiteFooter() {
  return <footer className="footer"><div className="shell"><div className="footer-grid"><div><Brand /><p style={{ maxWidth: 380, marginTop: 18 }}>A local marketplace for straightforward residential septic pumping in Johnston and Harnett Counties.</p></div><div><strong>Marketplace</strong><div className="footer-links"><Link href="/#get-a-quote">Get a quote</Link><Link href="/customer">Customer bookings</Link><Link href="/contractors">Join as a contractor</Link></div></div><div><strong>Company</strong><div className="footer-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="mailto:support@drainly.us">support@drainly.us</a></div></div></div><div className="footer-bottom"><span>© 2026 Drainly. Pilot marketplace.</span><span>Service performed by independent participating contractors.</span></div></div></footer>;
}
