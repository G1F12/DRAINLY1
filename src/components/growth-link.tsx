"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { captureGrowthEvent } from "@/lib/analytics-client";

export function GrowthLink({
  href,
  className,
  audience,
  placement,
  children,
}: {
  href: string;
  className?: string;
  audience: "customer" | "contractor";
  placement: "home_contractor" | "contractor_hero" | "service_area" | "customer_dashboard";
  children: ReactNode;
}) {
  return <Link href={href} className={className} onClick={() => captureGrowthEvent("growth_cta_click", { audience, placement })}>
    {children}
  </Link>;
}
