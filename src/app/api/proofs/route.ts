import { createHash } from "node:crypto";

import { z } from "zod";

import { apiError, getIdempotencyKey, parseJson, requireSameOrigin } from "@/lib/http";
import { getSystemDb } from "@/lib/system-db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasValidMagicBytes } from "@/modules/proofs/signature";

const prepareSchema = z.object({
  phase: z.literal("prepare"),
  orderId: z.uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(10_485_760),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const finalizeSchema = z.object({ phase: z.literal("finalize"), proofId: z.uuid() });
const schema = z.discriminatedUnion("phase", [prepareSchema, finalizeSchema]);

function extensionFor(mime: string) { return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp"; }
function storagePathFor(orderId: string, mime: string, idempotencyKey: string) {
  const objectKey = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
  return `${orderId}/${objectKey}.${extensionFor(mime)}`;
}
function deterministicUuid(value: string) {
  const source = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  source[12] = "4";
  source[16] = "8";
  const hex = source.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function POST(request: Request) {
  if (!requireSameOrigin(request)) return apiError("FORBIDDEN", "Origin is not allowed", 403);
  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) return apiError("BAD_REQUEST", "Idempotency-Key is required", 400);
  try {
    const body = await parseJson(request, schema);
    const client = await createSupabaseServerClient();
    if (!client) {
      return Response.json(body.phase === "prepare"
        ? { proofId: deterministicUuid(idempotencyKey), storagePath: storagePathFor(body.orderId, body.mimeType, idempotencyKey), uploadToken: "demo", demo: true }
        : { verified: true, demo: true });
    }
    if (body.phase === "prepare") {
      const path = storagePathFor(body.orderId, body.mimeType, idempotencyKey);
      const { data: proofId, error } = await client.rpc("register_job_proof", {
        p_order_id: body.orderId, p_storage_path: path, p_mime_type: body.mimeType, p_size_bytes: body.sizeBytes, p_checksum_sha256: body.checksumSha256,
        p_idempotency_key: idempotencyKey,
      });
      if (error) return apiError("FORBIDDEN", error.message, 403);
      const { data: upload, error: uploadError } = await client.storage.from("job-proofs").createSignedUploadUrl(path);
      if (uploadError) return apiError("PROVIDER_UNAVAILABLE", "Unable to prepare proof upload", 503);
      return Response.json({ proofId, storagePath: path, uploadToken: upload.token, signedUrl: upload.signedUrl });
    }
    const sql = getSystemDb();
    if (!sql) return apiError("PROVIDER_UNAVAILABLE", "Proof verifier database path is not configured", 503);
    const rows = await sql<{ context: { storagePath: string; mimeType: string; sizeBytes: number; checksumSha256: string } }[]>`
      select internal.get_proof_verification_context(${body.proofId}::uuid) as context
    `;
    const context = rows[0]?.context;
    if (!context) return apiError("BAD_REQUEST", "Pending proof was not found", 400);
    const { data, error } = await client.storage.from("job-proofs").download(context.storagePath);
    if (error || !data) return apiError("BAD_REQUEST", "Uploaded proof was not found", 400);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const verified = checksum === context.checksumSha256
      && bytes.byteLength === context.sizeBytes
      && data.type === context.mimeType
      && hasValidMagicBytes(bytes, context.mimeType);
    await sql`select internal.verify_job_proof(${body.proofId}::uuid, ${verified}, ${verified ? null : "Checksum or file signature mismatch"})`;
    return Response.json({ verified });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("BAD_REQUEST", "Invalid proof request", 400, error.flatten());
    return apiError("INTERNAL_ERROR", error instanceof Error ? error.message : "Proof operation failed", 500);
  }
}
