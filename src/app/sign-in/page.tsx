import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/sign-in-form";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Sign in" };
export default function SignInPage() { return <><SiteHeader /><main className="auth-wrap"><Suspense fallback={<div className="auth-card">Preparing secure sign-in…</div>}><SignInForm /></Suspense></main></>; }
