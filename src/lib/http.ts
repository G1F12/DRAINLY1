import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

import { getServerEnv } from "@/lib/env";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export function apiError(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details }, requestId: crypto.randomUUID() }, { status });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) throw new z.ZodError([]);
  return schema.parse(await request.json());
}

function addAllowedOrigin(origins: Set<string>, value: string | null | undefined) {
  if (!value) return;
  try {
    origins.add(new URL(value).origin);
  } catch {
    // Ignore malformed optional origin sources.
  }
}

function allowedRequestOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  // Canonical application URL.
  addAllowedOrigin(origins, getServerEnv().APP_BASE_URL);

  // Trust the URL already normalized by the framework/runtime. Do not trust
  // client-supplied forwarded-host/proto headers for CSRF origin decisions.
  addAllowedOrigin(origins, request.url);

  return origins;
}

export function requireSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV === "test";
  try {
    return allowedRequestOrigins(request).has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function getIdempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim();
  return key && key.length >= 8 && key.length <= 200 ? key : null;
}

export function hashRateLimitKey(value: string): string {
  const secret = getServerEnv().RATE_LIMIT_HMAC_SECRET ?? "development-only-rate-limit-secret-not-for-production";
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function constantTimeSecretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function clientAddress(request: Request): string {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}