import { expect, goto, test } from "./support/browser";

test("public home leads into an interactive checkout", async ({ page }) => {
  await goto(page, "/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Los Angeles");
  await page.getByRole("link", { name: "Buy Tickets" }).first().click();

  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ticket checkout" })).toBeVisible();

  const drinkPackage = page.getByRole("radio", { name: /Deck \+ Drink/ });
  await drinkPackage.click();
  await expect(drinkPackage).toBeChecked();
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
