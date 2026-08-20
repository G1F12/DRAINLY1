import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";
import { getServerEnv, isSupabaseConfigured } from "@/lib/env";

function isRealAuthEnabled() {
  const env = getServerEnv();
  return env.AUTH_PROVIDER_MODE === "real" || env.PROVIDER_MODE === "real";
}

async function createSupabaseAuthClient() {
  if (!isRealAuthEnabled() || !isSupabaseConfigured()) return null;
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient<Database, "api">(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: "api" },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Proxy refreshes auth cookies for Server Components.
          }
        },
      },
    },
  );
}

export async function sendEmailOtp(email: string) {
  const client = await createSupabaseAuthClient();
  if (!client) return { enabled: false as const };

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  return { enabled: true as const, error };
}

export async function verifyEmailOtp(email: string, token: string) {
  const client = await createSupabaseAuthClient();
  if (!client) return { enabled: false as const };

  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  return { enabled: true as const, error, user: data.user ?? null };
}

export async function getAuthenticatedUser() {
  const client = await createSupabaseAuthClient();
  if (!client) return null;

  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}
