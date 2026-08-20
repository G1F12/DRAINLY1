import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/logger";

describe("structured logging redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts nested and compound PII/provider keys", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    log("info", "test", {
      customerEmail: "person@example.test",
      service_address: "101 Private Road",
      nested: { providerPayload: { card: "4242" }, safeCount: 2 },
    });
    const record = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record.customerEmail).toBe("[REDACTED]");
    expect(record.service_address).toBe("[REDACTED]");
    expect(record.nested).toEqual({ providerPayload: "[REDACTED]", safeCount: 2 });
    expect(JSON.stringify(record)).not.toContain("person@example.test");
  });
});
