import { expect, test as base, type Locator, type Page } from "@playwright/test";

type BrowserHealthFixtures = {
  browserHealth: void;
};

export const test = base.extend<BrowserHealthFixtures>({
  browserHealth: [
    async ({ page }, use, testInfo) => {
      const browserIssues: string[] = [];
      const baseOrigin = new URL(String(testInfo.project.use.baseURL)).origin;

      await page.route("**/*", async (route) => {
        const requestURL = new URL(route.request().url());
        if (["http:", "https:"].includes(requestURL.protocol) && requestURL.origin !== baseOrigin) {
          await route.fulfill({ status: 204, body: "" });
          return;
        }
        await route.continue();
      });

      page.on("console", (message) => {
        if (message.type() === "error") {
          browserIssues.push(`console: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => {
        browserIssues.push(`pageerror: ${error.stack ?? error.message}`);
      });
      await use();

      expect(browserIssues, "browser workflows must not emit page or console errors").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };

export async function goto(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `expected a document response for ${path}`).not.toBeNull();
  expect(response?.ok(), `expected ${path} to load successfully`).toBe(true);
  return response!;
}

export function captureFailClosedResponse(page: Page, path: string) {
  let resolveStatus: (status: number) => void;
  const status = new Promise<number>((resolve) => {
    resolveStatus = resolve;
  });

  void page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    resolveStatus(response.status());

    // Chromium logs handled 503 responses as console errors. Keep the real body
    // and captured status while presenting the handled response as successful.
    await route.fulfill({ response, status: 200 });
  });

  return status;
}

export async function renderedContrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    type Rgb = [number, number, number];
    type Rgba = [number, number, number, number];

    function color(value: string): Rgba {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
    }

    function composite(foreground: Rgba, background: Rgb): Rgb {
      const alpha = foreground[3];
      return [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha)
      ];
    }

    function luminance(rgb: Rgb) {
      const channels = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      ancestors.push(current);
    }

    const background = ancestors.reverse().reduce<Rgb>((result, ancestor) => {
      return composite(color(getComputedStyle(ancestor).backgroundColor), result);
    }, [255, 255, 255]);
    const foreground = composite(color(getComputedStyle(element).color), background);
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));

    return (lighter + 0.05) / (darker + 0.05);
  });
}
