"use client";

import { CheckCircle2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ContractorConnectSandboxPanel } from "@/components/contractor-connect-sandbox-panel";

type RegionKind = "ZIP" | "COUNTY";
type TankTier = "GAL_750" | "GAL_1000" | "GAL_1250" | "GAL_1500";

type Profile = {
  exists?: boolean;
  company?: {
    legalName?: string;
    displayName?: string;
    primaryContactName?: string;
    email?: string;
    phone?: string;
    operatingAddress?: string | null;
    status?: string;
    stripeReady?: boolean;
  };
  regions?: Array<{ kind?: RegionKind; stateCode?: string; countyName?: string | null; postalCode?: string | null }>;
  availability?: Array<{ isoWeekday?: number; maxJobs?: number; urgentEnabled?: boolean }>;
  prices?: Array<{ tankTier?: TankTier; timingKind?: string; grossCents?: number }>;
  verifications?: Array<{ type?: string; status?: string; reference?: string | null }>;
  priceBookVersion?: number | null;
};

type RegionRow = { kind: RegionKind; stateCode: string; value: string };
type DayRow = { isoWeekday: number; enabled: boolean; maxJobs: string; urgentEnabled: boolean };
type PriceRow = { tankTier: TankTier; scheduled: string; urgent: string };

const DAYS = [
  [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"],
  [5, "Friday"], [6, "Saturday"], [7, "Sunday"],
] as const;

const TIERS: Array<[TankTier, string]> = [
  ["GAL_750", "750 gal"],
  ["GAL_1000", "1,000 gal"],
  ["GAL_1250", "1,250 gal"],
  ["GAL_1500", "1,500 gal"],
];

function emptyDays(): DayRow[] {
  return DAYS.map(([isoWeekday]) => ({ isoWeekday, enabled: false, maxJobs: "1", urgentEnabled: false }));
}

function emptyPrices(): PriceRow[] {
  return TIERS.map(([tankTier]) => ({ tankTier, scheduled: "", urgent: "" }));
}

function centsToDollars(value?: number) {
  return typeof value === "number" ? (value / 100).toFixed(2) : "";
}

function dollarsToCents(value: string): number | null {
  const cleaned = value.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const [whole, decimals = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number((decimals + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function ContractorOnboardingForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [companyStatus, setCompanyStatus] = useState("NEW");
  const [priceBookVersion, setPriceBookVersion] = useState<number | null>(null);
  const [company, setCompany] = useState({
    legalName: "",
    displayName: "",
    primaryContactName: "",
    email: "",
    phone: "",
    operatingAddress: "",
  });
  const [regions, setRegions] = useState<RegionRow[]>([{ kind: "ZIP", stateCode: "NC", value: "" }]);
  const [days, setDays] = useState<DayRow[]>(emptyDays());
  const [prices, setPrices] = useState<PriceRow[]>(emptyPrices());
  const [licenseReference, setLicenseReference] = useState("");
  const [insuranceReference, setInsuranceReference] = useState("");

  function applyProfile(profile: Profile) {
    if (!profile.exists || !profile.company) {
      setCompanyStatus("NEW");
      setLoading(false);
      return;
    }

    setCompanyStatus(profile.company.status ?? "PENDING");
    setPriceBookVersion(profile.priceBookVersion ?? null);
    setCompany({
      legalName: profile.company.legalName ?? "",
      displayName: profile.company.displayName ?? "",
      primaryContactName: profile.company.primaryContactName ?? "",
      email: profile.company.email ?? "",
      phone: profile.company.phone ?? "",
      operatingAddress: profile.company.operatingAddress ?? "",
    });

    if (profile.regions?.length) {
      setRegions(profile.regions.map((region) => ({
        kind: region.kind === "COUNTY" ? "COUNTY" : "ZIP",
        stateCode: region.stateCode ?? "NC",
        value: region.kind === "COUNTY" ? (region.countyName ?? "") : (region.postalCode ?? ""),
      })));
    }

    const availability = new Map((profile.availability ?? []).map((row) => [row.isoWeekday, row]));
    setDays(DAYS.map(([isoWeekday]) => {
      const row = availability.get(isoWeekday);
      const maxJobs = row?.maxJobs ?? 0;
      return {
        isoWeekday,
        enabled: maxJobs > 0,
        maxJobs: String(maxJobs > 0 ? maxJobs : 1),
        urgentEnabled: maxJobs > 0 && Boolean(row?.urgentEnabled),
      };
    }));

    setPrices(TIERS.map(([tankTier]) => {
      const scheduled = profile.prices?.find((row) => row.tankTier === tankTier && row.timingKind === "SCHEDULED");
      const urgent = profile.prices?.find((row) => row.tankTier === tankTier && row.timingKind === "URGENT");
      return {
        tankTier,
        scheduled: centsToDollars(scheduled?.grossCents),
        urgent: centsToDollars(urgent?.grossCents),
      };
    }));

    const license = profile.verifications?.find((row) => row.type === "LICENSE_OR_PERMIT");
    const insurance = profile.verifications?.find((row) => row.type === "INSURANCE");
    setLicenseReference(license?.reference ?? "");
    setInsuranceReference(insurance?.reference ?? "");
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/contractor/onboarding", { cache: "no-store" });
        const data = await response.json() as { profile?: Profile; error?: { message?: string } };
        if (cancelled) return;
        if (!response.ok || !data.profile) {
          setError(data.error?.message ?? "Unable to load contractor profile.");
          setLoading(false);
          return;
        }
        applyProfile(data.profile);
      } catch {
        if (!cancelled) {
          setError("Unable to load contractor profile.");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function updateRegion(index: number, patch: Partial<RegionRow>) {
    setRegions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function updateDay(isoWeekday: number, patch: Partial<DayRow>) {
    setDays((current) => current.map((row) => row.isoWeekday === isoWeekday ? { ...row, ...patch } : row));
  }

  function updatePrice(tankTier: TankTier, patch: Partial<PriceRow>) {
    setPrices((current) => current.map((row) => row.tankTier === tankTier ? { ...row, ...patch } : row));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSaved(undefined);

    const regionPayload = regions.map((region) => {
      const stateCode = region.stateCode.trim().toUpperCase();
      const value = region.value.trim();
      return region.kind === "ZIP"
        ? { kind: "ZIP" as const, stateCode, postalCode: value }
        : { kind: "COUNTY" as const, stateCode, countyName: value };
    });

    if (regionPayload.some((region) => !/^[A-Z]{2}$/.test(region.stateCode)
      || (region.kind === "ZIP" ? !/^[0-9]{5}$/.test(region.postalCode) : region.countyName.length < 2))) {
      setError("Check every service area. Use a two-letter state code and a valid ZIP or county name.");
      return;
    }

    const availability = days.map((day) => ({
      isoWeekday: day.isoWeekday,
      maxJobs: day.enabled ? Number(day.maxJobs) : 0,
      urgentEnabled: day.enabled && day.urgentEnabled,
    }));
    if (!availability.some((day) => Number.isInteger(day.maxJobs) && day.maxJobs > 0)
      || availability.some((day) => !Number.isInteger(day.maxJobs) || day.maxJobs < 0 || day.maxJobs > 100)) {
      setError("Choose at least one working day and use whole-number daily job limits.");
      return;
    }

    const pricePayload = prices.map((row) => ({
      tankTier: row.tankTier,
      scheduledCents: dollarsToCents(row.scheduled),
      urgentCents: dollarsToCents(row.urgent),
    }));
    if (pricePayload.some((row) => row.scheduledCents === null || row.urgentCents === null
      || (row.urgentCents ?? 0) < (row.scheduledCents ?? 0))) {
      setError("Enter scheduled and urgent prices for all four tank sizes. Urgent price cannot be lower.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/contractor/onboarding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `contractor-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          company: {
            legalName: company.legalName,
            displayName: company.displayName,
            primaryContactName: company.primaryContactName,
            phone: company.phone,
            operatingAddress: company.operatingAddress || undefined,
          },
          regions: regionPayload,
          availability,
          prices: pricePayload.map((row) => ({
            tankTier: row.tankTier,
            scheduledCents: row.scheduledCents!,
            urgentCents: row.urgentCents!,
          })),
          licenseReference: licenseReference || undefined,
          insuranceReference: insuranceReference || undefined,
        }),
      });
      const data = await response.json() as { profile?: Profile; error?: { message?: string } };
      if (!response.ok || !data.profile) {
        setError(data.error?.message ?? "Unable to save contractor profile.");
        return;
      }
      applyProfile(data.profile);
      setSaved("Profile saved. Live dispatch remains off until manual review and later payout onboarding are complete.");
    } catch {
      setError("Unable to save contractor profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="panel"><LoaderCircle className="animate-spin" size={22} /> Loading contractor profile...</div>;
  }

  return <form className="stack" onSubmit={submit}>
    <section className="panel">
      <div className="panel-header">
        <div><h2>Company</h2><p className="fine-print">Authenticated email is taken from your Drainly sign-in and cannot be spoofed by this form.</p></div>
        <span className="status status-info">{companyStatus}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
        <div className="field"><label htmlFor="legal-name">Legal company name</label><input id="legal-name" value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} required /></div>
        <div className="field"><label htmlFor="display-name">Public display name</label><input id="display-name" value={company.displayName} onChange={(e) => setCompany({ ...company, displayName: e.target.value })} required /></div>
        <div className="field"><label htmlFor="contact-name">Primary contact</label><input id="contact-name" value={company.primaryContactName} onChange={(e) => setCompany({ ...company, primaryContactName: e.target.value })} required /></div>
        <div className="field"><label htmlFor="company-phone">Phone</label><input id="company-phone" type="tel" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} required /></div>
        <div className="field"><label htmlFor="operating-address">Operating address</label><input id="operating-address" value={company.operatingAddress} onChange={(e) => setCompany({ ...company, operatingAddress: e.target.value })} /></div>
        {company.email && <div className="field"><label>Signed-in email</label><input value={company.email} disabled /></div>}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Service area</h2><p className="fine-print">Add the ZIP codes or counties your trucks actually serve.</p></div><button className="button button-secondary" type="button" onClick={() => setRegions((current) => [...current, { kind: "ZIP", stateCode: "NC", value: "" }])}><Plus size={17} /> Add area</button></div>
      <div className="stack">
        {regions.map((region, index) => <div className="list-row" key={`${index}-${region.kind}`}>
          <select value={region.kind} onChange={(e) => updateRegion(index, { kind: e.target.value as RegionKind, value: "" })} aria-label="Region type">
            <option value="ZIP">ZIP</option><option value="COUNTY">County</option>
          </select>
          <input value={region.stateCode} onChange={(e) => updateRegion(index, { stateCode: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="NC" aria-label="State code" />
          <input value={region.value} onChange={(e) => updateRegion(index, { value: e.target.value })} placeholder={region.kind === "ZIP" ? "27577" : "Johnston County"} aria-label={region.kind === "ZIP" ? "ZIP code" : "County name"} />
          <button className="button button-ghost" type="button" disabled={regions.length === 1} onClick={() => setRegions((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={16} /> Remove</button>
        </div>)}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Weekly capacity</h2><p className="fine-print">Daily capacity is your operational limit, not a promise that Drainly will send that many jobs.</p></div></div>
      <div className="list">
        {DAYS.map(([isoWeekday, label]) => {
          const day = days.find((row) => row.isoWeekday === isoWeekday)!;
          return <div className="list-row" key={isoWeekday}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={day.enabled} onChange={(e) => updateDay(isoWeekday, { enabled: e.target.checked, urgentEnabled: e.target.checked ? day.urgentEnabled : false })} /> <strong>{label}</strong></label>
            <div className="field"><label htmlFor={`jobs-${isoWeekday}`}>Max jobs</label><input id={`jobs-${isoWeekday}`} type="number" min={1} max={100} disabled={!day.enabled} value={day.maxJobs} onChange={(e) => updateDay(isoWeekday, { maxJobs: e.target.value })} /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" disabled={!day.enabled} checked={day.urgentEnabled} onChange={(e) => updateDay(isoWeekday, { urgentEnabled: e.target.checked })} /> Urgent jobs</label>
          </div>;
        })}
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Your pumping prices</h2><p className="fine-print">These are contractor-set prices by tank size. &quot;Earliest available&quot; uses your scheduled price for now; regional price optimization comes later.</p></div>{priceBookVersion && <span className="fine-print">Price book v{priceBookVersion}</span>}</div>
      <div className="list">
        {TIERS.map(([tankTier, label]) => {
          const row = prices.find((price) => price.tankTier === tankTier)!;
          return <div className="list-row" key={tankTier}>
            <strong>{label}</strong>
            <div className="field"><label htmlFor={`scheduled-${tankTier}`}>Scheduled price ($)</label><input id={`scheduled-${tankTier}`} inputMode="decimal" placeholder="0.00" value={row.scheduled} onChange={(e) => updatePrice(tankTier, { scheduled: e.target.value })} required /></div>
            <div className="field"><label htmlFor={`urgent-${tankTier}`}>Urgent price ($)</label><input id={`urgent-${tankTier}`} inputMode="decimal" placeholder="0.00" value={row.urgent} onChange={(e) => updatePrice(tankTier, { urgent: e.target.value })} required /></div>
          </div>;
        })}
      </div>
    </section>

    <ContractorConnectSandboxPanel />

    <section className="panel">
      <div className="panel-header"><div><h2>Verification references</h2><p className="fine-print">Optional at this step. Anything entered here is marked submitted, not verified. Drainly operations must review it manually.</p></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
        <div className="field"><label htmlFor="license-ref">License / permit reference</label><input id="license-ref" value={licenseReference} onChange={(e) => setLicenseReference(e.target.value)} maxLength={160} /></div>
        <div className="field"><label htmlFor="insurance-ref">Insurance reference</label><input id="insurance-ref" value={insuranceReference} onChange={(e) => setInsuranceReference(e.target.value)} maxLength={160} /></div>
      </div>
    </section>

    {error && <div className="form-error" role="alert">{error}</div>}
    {saved && <div className="success-box"><CheckCircle2 size={17} style={{ display: "inline", marginRight: 7 }} />{saved}</div>}
    <div><button className="button button-primary" disabled={saving}>{saving ? <><LoaderCircle size={18} className="animate-spin" /> Saving...</> : "Save contractor profile"}</button></div>
  </form>;
}
