type LogLevel = "info" | "warn" | "error";

const sensitiveKeyFragments = ["email", "phone", "address", "note", "token", "secret", "password", "paymentmethod", "providerpayload", "authorization"];

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
      const normalized = key.toLowerCase().replaceAll("_", "");
      return [key, sensitiveKeyFragments.some((fragment) => normalized.includes(fragment)) ? "[REDACTED]" : sanitize(nested)];
    }));
  }
  return value;
}

export function log(level: LogLevel, event: string, metadata: Record<string, unknown> = {}) {
  const cleaned = sanitize(metadata) as Record<string, unknown>;
  const record = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...cleaned });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}
