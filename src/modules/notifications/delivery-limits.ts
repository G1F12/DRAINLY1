export const OUTBOX_LEASE_MS = 120_000;
export const DEFAULT_OUTBOUND_PROVIDER_TIMEOUT_MS = 40_000;

export class OutboundProviderTimeoutError extends Error {
  constructor() {
    super("OUTBOUND_PROVIDER_TIMEOUT");
    this.name = "OutboundProviderTimeoutError";
  }
}

export async function withOutboundProviderTimeout<T>(
  providerCall: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_OUTBOUND_PROVIDER_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs >= OUTBOX_LEASE_MS / 2) {
    throw new Error("INVALID_OUTBOUND_PROVIDER_TIMEOUT");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OutboundProviderTimeoutError());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([providerCall(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
