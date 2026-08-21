import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const analytics = readFileSync("src/lib/analytics-client.ts", "utf8");
const quote = readFileSync("src/components/quote-wizard.tsx", "utf8");
const leadRoute = readFileSync("src/app/api/growth/leads/route.ts", "utf8");
const referralRoute = readFileSync("src/app/r/[code]/route.ts", "utf8");
const customer = readFileSync("src/app/customer/page.tsx", "utf8");
const outbox = readFileSync("src/modules/notifications/outbox.ts", "utf8");
const templates = readFileSync("src/modules/notifications/templates.ts", "utf8");
const robots = readFileSync("src/app/robots.ts", "utf8");
const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260821173957_stage6_growth_system.sql", "utf8");
const domainGrant = readFileSync("supabase/migrations/20260821170330_stage5_1_contractor_security_invoker_schema_usage.sql", "utf8");
const identityGrant = readFileSync("supabase/migrations/20260821170521_stage5_1_identity_helpers_for_security_invoker.sql", "utf8");

describe("Stage 6 complete growth engineering", () => {
  it("syncs the production Stage 5.1 permission repair", () => {
    expect(domainGrant).toContain("grant usage on schema domain to authenticated");
    expect(identityGrant).toContain("grant execute on function identity.uid() to authenticated");
  });

  it("keeps growth analytics non-identifying", () => {
    expect(analytics).toContain("never pass address/ZIP");
    expect(analytics).not.toContain("normalizedAddress");
    expect(analytics).not.toContain("postalCode");
    expect(analytics).not.toContain("quoteId:");
    expect(quote).toContain('captureGrowthEvent("quote_submit")');
    expect(quote).toContain('captureGrowthEvent("quote_result"');
  });

  it("requires explicit consent and persistent rate limiting for lead capture", () => {
    expect(leadRoute).toContain("z.literal(true)");
    expect(leadRoute).toContain("consumeGrowthRateLimit");
    expect(migration).toContain("domain.growth_leads");
    expect(migration).toContain("consent_at");
  });

  it("implements referral attribution without visitor fingerprinting", () => {
    expect(referralRoute).toContain('httpOnly: true');
    expect(referralRoute).toContain('sameSite: "lax"');
    expect(migration).toContain("domain.referral_visits");
    expect(migration).toContain("internal.attribute_referral_quote");
    expect(migration).not.toContain("user_agent");
    expect(migration).not.toContain("ip_address");
  });

  it("implements opt-in annual retention through the existing notification pipeline", () => {
    expect(customer).toContain("CustomerGrowthPanel");
    expect(migration).toContain("annual_service_checkin");
    expect(migration).toContain("SEND_GROWTH_SERVICE_CHECKIN");
    expect(outbox).toContain("SEND_GROWTH_SERVICE_CHECKIN");
    expect(templates).toContain('topic === "growth.service_checkin"');
    expect(templates).toContain("not a statement that pumping is currently required");
  });

  it("adds local SEO and keeps private application routes out of indexing", () => {
    expect(sitemap).toContain("/service-area/johnston-county-nc");
    expect(sitemap).toContain("/service-area/harnett-county-nc");
    expect(robots).toContain('"/api/"');
    expect(robots).toContain('"/admin/"');
    expect(robots).toContain('"/customer"');
  });

  it("does not modify payment or pilot execution controls", () => {
    expect(migration).not.toContain("booking_execution_enabled = true");
    expect(migration).not.toContain("payment_execution_enabled = true");
    expect(migration).not.toContain("sk_live_");
  });
});
