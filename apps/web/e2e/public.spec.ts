import { expect, goto, test } from "./support/browser";

test("public home presents the approved showcase and only full-venue booking", async ({ page }) => {
  await goto(page, "/");

  await expect(page.locator(".showcaseOverlay").first().getByText("The gallery hall.")).toBeVisible();
  await expect(page.locator("#book-venue").getByText("Individual tickets are not available.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The full venue. One private booking." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Full venue booking" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request availability" })).toHaveAttribute(
    "href",
    /mailto:reservations@skydeckla\.com/
  );

  await expect(page.getByRole("link", { name: /buy tickets/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /date night/i })).toHaveCount(0);
  await expect(page.locator('a[href="/checkout"]')).toHaveCount(0);
  await expect(page.getByText(/\$20|\$29|planned launch pricing/i)).toHaveCount(0);
});

test("checkout is gated with the full-venue-only offer", async ({ page }) => {
  await goto(page, "/checkout");

  const banner = page.getByRole("status");
  await expect(banner).toContainText("Full venue bookings only");
  await expect(banner).toContainText("Individual tickets are not available");

  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  const statusPanel = page.getByRole("region", { name: "Ticket sales status" });
  await expect(statusPanel).toContainText("full-venue booking inquiries only");
  await expect(page.getByRole("region", { name: "Ticket checkout" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("public surfaces have no horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/", "/checkout"]) {
    await goto(page, path);
    const overflowPixels = await page.evaluate(() => {
      const contentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return contentWidth - document.documentElement.clientWidth;
    });
    expect(overflowPixels).toBeLessThanOrEqual(1);
  }
});

test("reduced motion renders all showcase chapters as a complete static story", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto(page, "/");

  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.locator(".showcaseStatic")).toHaveCount(7);
  await expect(page.locator("html")).not.toHaveClass(/showcaseScrub/);
  await expect(page.getByRole("heading", { level: 1, name: "The gallery hall." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Take the whole view." })).toBeVisible();
});
