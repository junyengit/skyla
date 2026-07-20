import { expect, goto, renderedContrastRatio, test } from "./support/browser";

test("retired public pages permanently redirect to the simple homepage", async ({ page }) => {
  for (const retired of ["/members", "/experiences", "/about", "/cafe"]) {
    const response = await page.request.get(retired, { maxRedirects: 0 });
    expect(response.status(), `${retired} must be a permanent redirect`).toBe(308);
    expect(new URL(response.headers().location ?? "", "http://localhost").pathname).toBe("/");
  }

  await goto(page, "/members");
  await expect(page).toHaveURL(/\/$/);
});

test("admin remains unavailable with readable setup guidance", async ({ page }) => {
  await goto(page, "/admin");

  const setupLabel = page.getByText("Setup required", { exact: true });
  const setupGuidance = page.getByText("Clerk and Convex are not linked yet.", { exact: true });
  await expect(setupLabel).toBeVisible();
  await expect(setupGuidance).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Snapshot" })).toBeDisabled();
  expect(await renderedContrastRatio(setupLabel)).toBeGreaterThanOrEqual(4.5);
  expect(await renderedContrastRatio(setupGuidance)).toBeGreaterThanOrEqual(4.5);
});

test("POS remains unavailable with readable disabled controls", async ({ page }) => {
  await goto(page, "/pos");

  const setupLabel = page.getByText("Setup required", { exact: true });
  const setupGuidance = page.getByText("Clerk and Convex are not linked yet.", { exact: true });
  await expect(setupLabel).toBeVisible();
  await expect(setupGuidance).toBeVisible();
  await expect(page.getByRole("button", { name: "Load Readers" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Review Sale" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send to Reader" })).toBeDisabled();
  await expect(page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]')).toHaveCount(1);
  expect(await renderedContrastRatio(setupLabel)).toBeGreaterThanOrEqual(4.5);
  expect(await renderedContrastRatio(setupGuidance)).toBeGreaterThanOrEqual(4.5);
});

test("legacy POS URL redirects to the primary POS", async ({ page }) => {
  const response = await page.goto("/pos.html", { waitUntil: "domcontentloaded" });
  const redirectRequest = response?.request().redirectedFrom();
  const redirectResponse = await redirectRequest?.response();

  expect(redirectResponse?.status()).toBe(308);
  expect(redirectResponse?.headers()["location"]).toMatch(/\/pos$/);
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.locator("main[data-pos-route='primary']")).toBeVisible();
});
