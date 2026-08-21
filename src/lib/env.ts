import "server-only";

import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalSecret = z.string().optional().or(z.literal(""));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PROVIDER_MODE: z.enum(["fake", "real"]).default("fake"),
  AUTH_PROVIDER_MODE: z.enum(["fake", "real"]).default("fake"),
  NOTIFICATION_PROVIDER_MODE: z.enum(["fake", "real"]).default("fake"),
  PAYMENT_PROVIDER_MODE: z.enum(["fake", "stripe_test"]).default("fake"),
  PILOT_MODE: z.enum(["off", "sandbox"]).default("off"),
  PILOT_ALLOWED_EMAILS: z.string().default(""),
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  DRAINLY_SYSTEM_DATABASE_URL: optionalUrl,
  CRON_SECRET: z.string().min(32).optional(),
  RATE_LIMIT_HMAC_SECRET: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: optionalSecret,
  EMAIL_FROM: z.string().default("Drainly <bookings@example.invalid>"),
  OPS_ALERT_EMAIL: z.email().optional(),
  SENTRY_DSN: z.string().optional(),
  OUTBOUND_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(59_000).default(40_000),
  FAKE_NOTIFICATION_BEHAVIOR: z.enum(["success", "failure", "timeout"]).default("success"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  if (cached.PROVIDER_MODE === "real") {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "DRAINLY_SYSTEM_DATABASE_URL",
      "CRON_SECRET",
      "RATE_LIMIT_HMAC_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "GOOGLE_MAPS_SERVER_KEY",
    ] as const;
    const missing = required.filter((key) => !cached?.[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required real-provider configuration: ${missing.join(", ")}`);
    }
    if (!cached.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      throw new Error("Drainly implementation accepts Stripe test-mode secret keys only");
    }
  }
  if (cached.PAYMENT_PROVIDER_MODE === "stripe_test") {
    const required = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ] as const;
    const missing = required.filter((key) => !cached?.[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required Stripe test configuration: ${missing.join(", ")}`);
    }
    if (!cached.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      throw new Error("Drainly payment adapter accepts Stripe test-mode secret keys only");
    }
  }
  if (cached.AUTH_PROVIDER_MODE === "real") {
    const required = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ] as const;
    const missing = required.filter((key) => !cached?.[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required real auth configuration: ${missing.join(", ")}`);
    }
  }
  if (cached.NOTIFICATION_PROVIDER_MODE === "real") {
    const required = [
      "DRAINLY_SYSTEM_DATABASE_URL",
      "CRON_SECRET",
      "RATE_LIMIT_HMAC_SECRET",
      "RESEND_API_KEY",
      "RESEND_WEBHOOK_SECRET",
    ] as const;
    const missing = required.filter((key) => !cached?.[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required real notification configuration: ${missing.join(", ")}`);
    }
    if (cached.EMAIL_FROM.includes("example.invalid")) {
      throw new Error("EMAIL_FROM must use a verified sender for real notifications");
    }
  }
  return cached;
}

export function isSupabaseConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
