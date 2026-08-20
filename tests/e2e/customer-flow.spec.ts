import { expect, test } from "@playwright/test";

test("customer receives a firm supported quote", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Septic pumping without the phone calls/i })).toBeVisible();
  await page.getByLabel("Street address").fill("101 Fictional Farm Road");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByLabel("ZIP code").fill("27577");
  await page.getByRole("button", { name: /See my price/i }).click();
  await expect(page.getByText("Firm pilot quote")).toBeVisible();
  await expect(page.getByText("$365.00")).toBeVisible();
  await expect(page.getByText(/currently viable contractor/i)).toBeVisible();
});

test("unknown tank size requests review instead of inventing a price", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Street address").fill("101 Fictional Farm Road");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByLabel("ZIP code").fill("27577");
  await page.getByLabel("Tank size").selectOption("UNKNOWN");
  await page.getByRole("button", { name: /See my price/i }).click();
  await expect(page.getByText("This request needs a manual review")).toBeVisible();
});

test("contractor dashboard communicates the authorization gate", async ({ page }) => {
  await page.goto("/contractor");
  await expect(page.getByRole("heading", { name: "Today's field board." })).toBeVisible();
  await expect(page.getByText("Authorization required before route start")).toBeVisible();
  await expect(page.getByText("Expected payout").first()).toBeVisible();
});
