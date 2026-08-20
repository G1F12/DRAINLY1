"use client";

import { Camera, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export function ProofUploader({ orderId }: { orderId: string }) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  async function upload(file: File) {
    if (!(["image/jpeg", "image/png", "image/webp"].includes(file.type)) || file.size > 10_485_760) return setMessage("Use a JPEG, PNG, or WebP up to 10 MB.");
    setWorking(true); setMessage(undefined);
    try {
      const checksumSha256 = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      const prepare = await fetch("/api/proofs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `proof-prepare-${crypto.randomUUID()}` }, body: JSON.stringify({ phase: "prepare", orderId, mimeType: file.type, sizeBytes: file.size, checksumSha256 }) });
      const prepared = await prepare.json() as { proofId?: string; storagePath?: string; uploadToken?: string; demo?: boolean; error?: { message?: string } };
      if (!prepare.ok || !prepared.proofId || !prepared.storagePath) throw new Error(prepared.error?.message ?? "Proof upload could not be prepared");
      if (!prepared.demo) {
        const client = createSupabaseBrowserClient();
        if (!client || !prepared.uploadToken) throw new Error("Storage upload is not configured");
        const { error } = await client.storage.from("job-proofs").uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file, { contentType: file.type });
        if (error) throw error;
      }
      const finalize = await fetch("/api/proofs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `proof-finalize-${prepared.proofId}` }, body: JSON.stringify({ phase: "finalize", proofId: prepared.proofId }) });
      const finalized = await finalize.json() as { verified?: boolean; error?: { message?: string } };
      if (!finalize.ok || !finalized.verified) throw new Error(finalized.error?.message ?? "Proof validation failed");
      setMessage("Proof verified");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Proof upload failed"); }
    finally { setWorking(false); }
  }
  return <label className="button button-secondary" style={{ minHeight: 38, paddingInline: 12, cursor: working ? "wait" : "pointer" }}>
    {working ? <LoaderCircle className="animate-spin" size={16} /> : <Camera size={16} />}{message ?? "Upload proof"}
    <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={working} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
  </label>;
}
