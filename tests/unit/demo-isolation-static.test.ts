import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const supabaseServer = readFileSync("src/lib/supabase/server.ts", "utf8");
const systemDb = readFileSync("src/lib/system-db.ts", "utf8");
const proxy = readFileSync("src/proxy.ts", "utf8");
const notificationGateway = readFileSync("src/modules/notifications/gateway.ts", "utf8");
const stripeWebhook = readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
const customerPage = readFileSync("src/app/customer/page.tsx", "utf8");

describe("demo provider isolation source invariants", () => {
  it("does not create Supabase or privileged database clients in core fake mode", () => {
    expect(supabaseServer).toContain('if (env.PROVIDER_MODE !== "real") return null;');
    expect(systemDb).toContain('if (env.PROVIDER_MODE !== "real") return null;');
    expect(supabaseServer.indexOf('if (env.PROVIDER_MODE !== "real") return null;')).toBeLessThan(supabaseServer.indexOf("createServerClient<"));
    expect(systemDb.indexOf('if (env.PROVIDER_MODE !== "real") return null;')).toBeLessThan(systemDb.indexOf("return getSharedSystemDb(connectionString);"));
  });

  it("skips Supabase session refresh in demo middleware", () => {
    expect(proxy).toContain('const providerMode = (process.env.PROVIDER_MODE ?? "fake")');
    expect(proxy).toContain('if (providerMode !== "real")');
    expect(proxy.indexOf('if (providerMode !== "real")')).toBeLessThan(proxy.indexOf("createServerClient(url, key"));
  });

  it("keeps notification provider selection independent from core provider mode", () => {
    expect(env).toContain('NOTIFICATION_PROVIDER_MODE: z.enum(["fake", "real"]).default("fake")');
    expect(notificationGateway).toContain('env.NOTIFICATION_PROVIDER_MODE === "real"');
    expect(notificationGateway).not.toContain('gateway = env.PROVIDER_MODE === "real"');
  });

  it("ignores Stripe webhooks before parsing or persistence while core providers are fake", () => {
    expect(stripeWebhook).toContain('if (getServerEnv().PROVIDER_MODE !== "real")');
    expect(stripeWebhook.indexOf('if (getServerEnv().PROVIDER_MODE !== "real")')).toBeLessThan(stripeWebhook.indexOf("request.text()"));
    expect(stripeWebhook.indexOf('if (getServerEnv().PROVIDER_MODE !== "real")')).toBeLessThan(stripeWebhook.indexOf("getSystemDb()"));
  });

  it("does not render customer write actions in demo mode", () => {
    expect(customerPage).toContain("DRN-DEMO-1042");
    expect(customerPage).toContain('demoMode ? <span className="status status-info">Demo only</span> : <CustomerOrderActions');
  });
});
