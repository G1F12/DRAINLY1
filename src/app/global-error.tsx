"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.captureException(error); }, [error]);
  return <html lang="en"><body><main className="shell" style={{ paddingBlock: 80 }}><h1>Something went wrong.</h1><p>The error was recorded without customer details. Please try again.</p><button className="button button-primary" onClick={reset}>Try again</button></main></body></html>;
}
