"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type SessionState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; dashboardHref: string };

export function HeaderAuthActions() {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await response.json() as { signedIn?: boolean; dashboardHref?: string };
        if (cancelled) return;
        if (response.ok && data.signedIn) {
          setState({ kind: "signed-in", dashboardHref: data.dashboardHref ?? "/customer" });
        } else {
          setState({ kind: "signed-out" });
        }
      } catch {
        if (!cancelled) setState({ kind: "signed-out" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.kind !== "signed-in") {
    return <Link href="/sign-in">Sign in</Link>;
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setSigningOut(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return <>
    <Link href={state.dashboardHref}>Dashboard</Link>
    <button
      type="button"
      onClick={signOut}
      disabled={signingOut}
      style={{
        appearance: "none",
        background: "transparent",
        border: 0,
        padding: 0,
        font: "inherit",
        cursor: signingOut ? "wait" : "pointer",
      }}
    >
      {signingOut ? "Signing out..." : "Log out"}
    </button>
  </>;
}
