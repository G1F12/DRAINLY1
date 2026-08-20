import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const env = readFileSync("src/lib/env.ts", "utf8");
const auth = readFileSync("src/lib/supabase/auth.ts", "utf8");
const server = readFileSync("src/lib/supabase/server.ts", "utf8");
const proxy = readFileSync("src/proxy.ts", "utf8");
const otp = readFileSync("src/app/api/auth/otp/route.ts", "utf8");
const verify = readFileSync("src/app/api/auth/verify/route.ts", "utf8");

describe("real auth isolation source invariants", () => {
  it("keeps auth mode independent from core and notification providers", () => {
    expect(env).toContain('AUTH_PROVIDER_MODE: z.enum(["fake", "real"]).default("fake")');
    expect(auth).toContain('env.AUTH_PROVIDER_MODE === "real" || env.PROVIDER_MODE === "real"');
    expect(proxy).toContain('process.env.AUTH_PROVIDER_MODE ?? "fake"');
  });

  it("uses a dedicated auth helper for OTP without enabling the core database client", () => {
    expect(otp).toContain("sendEmailOtp");
    expect(otp).not.toContain("createSupabaseServerClient");
    expect(auth).toContain("client.auth.signInWithOtp");
    expect(auth).toContain("client.auth.verifyOtp");
  });

  it("keeps customer profile persistence behind core real mode", () => {
    const guard = 'if (getServerEnv().PROVIDER_MODE === "real")';
    expect(verify).toContain(guard);
    expect(verify.indexOf(guard)).toBeLessThan(verify.indexOf('client.rpc("ensure_customer_profile"'));
  });

  it("lets authenticated identity be read without exposing a core write client", () => {
    expect(server).toContain("return getAuthenticatedUser();");
    expect(server).toContain('if (env.PROVIDER_MODE !== "real") return null;');
    expect(auth).not.toContain(".from(");
    expect(auth).not.toContain(".rpc(");
  });
});
