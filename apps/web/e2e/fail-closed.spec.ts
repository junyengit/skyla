import { captureFailClosedResponse, expect, goto, renderedContrastRatio, test } from "./support/browser";

test("membership application fails closed when Convex is unavailable", async ({ page }) => {
  await goto(page, "/members");

  await page.getByLabel("First name").fill("Browser");
  await page.getByLabel("Last name").fill("Test");
  await page.getByLabel("Email").fill("browser.member@example.test");

  const backendStatus = captureFailClosedResponse(page, "/api/members/applications");
  await page.getByRole("button", { name: /Submit Application/ }).click();

  expect(await backendStatus).toBe(503);
  await expect(page.getByText(/Membership applications are temporarily unavailable/)).toBeVisible();
});

test("experience inquiry fails closed when Convex is unavailable", async ({ page }) => {
  await goto(page, "/experiences");

  await page.getByLabel("First name").fill("Browser");
  await page.getByLabel("Last name").fill("Test");
  await page.getByLabel("Email address").fill("browser.experience@example.test");
  await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("date-night");
  await page.getByLabel("Preferred date").fill("2030-07-20");

  const backendStatus = captureFailClosedResponse(page, "/api/experiences/inquiries");
  await page.getByRole("button", { name: "Request event details" }).click();

  expect(await backendStatus).toBe(503);
  await expect(page.getByText(/Experience requests are temporarily unavailable/)).toBeVisible();
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
