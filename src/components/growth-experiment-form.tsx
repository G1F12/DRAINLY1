"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GrowthExperimentForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(formData: FormData) {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch("/api/admin/growth/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData.entries())),
      });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "Unable to update experiment.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update experiment.");
    } finally { setLoading(false); }
  }

  return <form action={submit} className="form-grid">
    <div className="field"><label htmlFor="experimentKey">Experiment key</label><input id="experimentKey" name="experimentKey" required pattern="[a-z0-9][a-z0-9_-]{2,63}" placeholder="county-page-cta" /></div>
    <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue="DRAFT"><option>DRAFT</option><option>RUNNING</option><option>PAUSED</option><option>COMPLETED</option></select></div>
    <div className="field field-full"><label htmlFor="hypothesis">Hypothesis</label><textarea id="hypothesis" name="hypothesis" minLength={10} maxLength={1000} required placeholder="What measurable behavior should change?" /></div>
    <div className="field field-full"><label htmlFor="guardrail">Guardrail</label><textarea id="guardrail" name="guardrail" minLength={5} maxLength={1000} required placeholder="What must not get worse?" /></div>
    {error && <div className="form-error field-full" role="alert">{error}</div>}
    <button className="button button-secondary field-full" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={17} className="animate-spin" /> Saving...</> : "Save experiment"}</button>
  </form>;
}
