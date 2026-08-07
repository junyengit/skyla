import { expect, goto, test } from "./support/browser";

test("public home announces the pre-launch status before any price or ticket path", async ({ page }) => {
  await goto(page, "/");

  const banner = page.getByRole("status");
  await expect(banner).toContainText("Coming soon");
  await expect(banner).toContainText("Sky LA is not open yet. Ticket sales are not live.");
  await expect(banner.getByRole("link", { name: "reservations@skydeckla.com" })).toBeVisible();

  // The status band sits above the first price mention.
  const bannerBox = await banner.boundingBox();
  const priceBox = await page.getByText("$20").first().boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(priceBox).not.toBeNull();
  expect(bannerBox!.y).toBeLessThan(priceBox!.y);

  // Purchase paths are replaced with non-link status and an email CTA.
  await expect(page.getByRole("link", { name: "Buy Tickets" })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByText("Coming Soon")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Coming Soon" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ask about opening" })).toBeVisible();

  // Prices are framed as planned, and hours are not presented as current.
  await expect(page.getByText(/planned launch pricing/i)).toBeVisible();
  await expect(page.getByText(/opening hours will be announced before launch/i)).toBeVisible();
  await expect(page.getByText(/Monday:/)).toHaveCount(0);
});

test("checkout is gated while ticket sales are not live", async ({ page }) => {
  await goto(page, "/checkout");

  const banner = page.getByRole("status");
  await expect(banner).toContainText("Coming soon");
  await expect(banner).toContainText("Sky LA is not open yet. Ticket sales are not live.");

  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  const statusPanel = page.getByRole("region", { name: "Ticket sales status" });
  await expect(statusPanel).toBeVisible();
  await expect(statusPanel).toContainText("Ticket sales are not live.");

  // No interactive ticket form or card-payment path is present.
  await expect(page.getByRole("region", { name: "Ticket checkout" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/secure hosted card payment/i)).toHaveCount(0);

  await expect(
    page.getByRole("link", { name: /reservations@skydeckla\.com/ }).first()
  ).toBeVisible();
});

test("checkout has no horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, "/checkout");

  const overflowPixels = await page.evaluate(() => {
    const contentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return contentWidth - document.documentElement.clientWidth;
  });

  expect(overflowPixels).toBeLessThanOrEqual(1);
});

test("home renders its primary content without hero motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto(page, "/");

  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const initialHeroState = await page.locator(".heroContent").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity,
      transform: style.transform,
      animations: element.getAnimations({ subtree: true }).length
    };
  });

  expect(initialHeroState).toEqual({ opacity: "1", transform: "none", animations: 0 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Los Angeles");
});

test("home builds a descending spiral staircase through native desktop scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await goto(page, "/");

  const story = page.locator(".staircaseStory");
  const rail = story.locator(".staircaseRailDraw");
  await expect(story).toHaveAttribute("data-scroll-mode", "descending");
  await expect(page.getByRole("heading", { level: 2, name: "The view keeps building." })).toBeVisible();
  await expect(story.locator(".staircaseLevel")).toHaveCount(7);

  const initialRailStyle = await rail.getAttribute("style");

  await page.evaluate(() => {
    const section = document.querySelector<HTMLElement>(".staircaseStory");
    if (!section) throw new Error("staircase story missing");
    window.scrollTo({ top: section.offsetTop + section.offsetHeight * 0.44 });
  });

  await expect.poll(async () => {
    return rail.getAttribute("style");
  }).not.toBe(initialRailStyle);

  const storyMechanics = await story.evaluate((section) => {
    const stickyDescendants = [...section.querySelectorAll("*")].filter(
      (element) => getComputedStyle(element).position === "sticky"
    ).length;
    const landingTransforms = [...section.querySelectorAll(".staircaseLanding")].map(
      (landing) => getComputedStyle(landing).transform
    );
    return { stickyDescendants, distinctTransforms: new Set(landingTransforms).size };
  });
  expect(storyMechanics.stickyDescendants).toBe(0);
  expect(storyMechanics.distinctTransforms).toBeGreaterThan(2);

  const overflowPixels = await page.evaluate(() => {
    const contentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return contentWidth - document.documentElement.clientWidth;
  });
  expect(overflowPixels).toBeLessThanOrEqual(1);
});

test("spiral staircase becomes a complete linear sequence for reduced motion and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goto(page, "/");

  const story = page.locator(".staircaseStory");
  await expect(story).toHaveAttribute("data-scroll-mode", "static");
  await expect(story.getByText("Century City", { exact: true })).toBeVisible();
  await expect(story.locator(".staircaseLevelFact").filter({ hasText: "Timed entry" })).toBeVisible();

  const layout = await story.locator(".staircaseLanding").first().evaluate((landing) => {
    const style = getComputedStyle(landing);
    return { position: style.position, transform: style.transform, opacity: style.opacity };
  });
  expect(layout).toEqual({ position: "relative", transform: "none", opacity: "1" });

  const overflowPixels = await page.evaluate(() => {
    const contentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return contentWidth - document.documentElement.clientWidth;
  });
  expect(overflowPixels).toBeLessThanOrEqual(1);
});
