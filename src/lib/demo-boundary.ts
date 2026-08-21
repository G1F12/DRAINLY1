import "server-only";

import { getServerEnv } from "@/lib/env";

export function allowDemoFallback(): boolean {
  const env = getServerEnv();
  return process.env.NODE_ENV !== "production"
    && env.PROVIDER_MODE !== "real"
    && env.AUTH_PROVIDER_MODE !== "real";
}