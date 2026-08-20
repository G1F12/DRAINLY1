import type { Metadata } from "next";
import { AnalyticsProvider } from "@/components/analytics-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://127.0.0.1:3000"),
  title: { default: "Drainly | Septic pumping without the phone calls", template: "%s | Drainly" },
  description: "Book residential septic pumping online in Johnston and Harnett Counties, North Carolina.",
  openGraph: { title: "Drainly", description: "Septic pumping without the phone calls.", type: "website", locale: "en_US", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Septic service professional at a North Carolina home" }] },
  twitter: { card: "summary_large_image", title: "Drainly", description: "Septic pumping without the phone calls.", images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full"><AnalyticsProvider>{children}</AnalyticsProvider></body>
    </html>
  );
}
