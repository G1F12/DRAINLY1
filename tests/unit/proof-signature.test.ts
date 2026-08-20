import { describe, expect, it } from "vitest";

import { hasValidMagicBytes } from "@/modules/proofs/signature";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("proof MIME-specific magic bytes", () => {
  it.each([
    [jpeg, "image/jpeg"],
    [png, "image/png"],
    [webp, "image/webp"],
  ])("accepts matching bytes", (bytes, mime) => expect(hasValidMagicBytes(bytes, mime)).toBe(true));

  it.each([
    [png, "image/jpeg"],
    [jpeg, "image/png"],
    [webp, "image/jpeg"],
    [Uint8Array.from([1, 2, 3, 4]), "image/jpeg"],
    [png, "image/gif"],
  ])("rejects mismatched, corrupt, or unsupported bytes", (bytes, mime) => expect(hasValidMagicBytes(bytes, mime)).toBe(false));
});
