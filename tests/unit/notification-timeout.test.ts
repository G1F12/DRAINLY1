import { describe, expect, it, vi } from "vitest";

import {
  OUTBOX_LEASE_MS,
  OutboundProviderTimeoutError,
  withOutboundProviderTimeout,
} from "@/modules/notifications/delivery-limits";

describe("outbound provider timeout", () => {
  it("aborts a provider call well before the outbox lease expires", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const call = withOutboundProviderTimeout((signal) => new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("provider aborted")); }, { once: true });
    }), 40_000);
    const rejection = expect(call).rejects.toBeInstanceOf(OutboundProviderTimeoutError);
    await vi.advanceTimersByTimeAsync(40_000);
    await rejection;
    expect(aborted).toBe(true);
    expect(40_000).toBeLessThan(OUTBOX_LEASE_MS / 2);
    vi.useRealTimers();
  });

  it("rejects timeout configuration that could approach lease expiry", async () => {
    await expect(withOutboundProviderTimeout(async () => undefined, OUTBOX_LEASE_MS / 2)).rejects.toThrow("INVALID_OUTBOUND_PROVIDER_TIMEOUT");
  });
});
