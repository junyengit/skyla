// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@skyla/config";

import CheckoutPage from "./app/checkout/page";
import { installCheckoutBrowserPlatform, routeCheckoutFetch } from "./checkout-test-support";
import { CheckoutClient } from "./components/checkout-client";
import { localAdmissionPreviewEnabled } from "./lib/local-admission-preview";

vi.mock("./lib/public-operating-config", () => ({
  loadPublicOperatingConfig: vi.fn(async () => null)
}));

function renderCheckout() {
  return render(
    <CheckoutClient packages={[{ key: "general", name: "The View", priceCents: 2000 }]} operatingHours={null} />
  );
}

function partyTotal(label: "Total visitors" | "Estimated total") {
  return screen.getByText(label).nextElementSibling?.textContent;
}

function click(name: string, times = 1) {
  const button = screen.getByRole("button", { name });
  for (let index = 0; index < times; index += 1) fireEvent.click(button);
}

let router: ReturnType<typeof routeCheckoutFetch>;
let platform: ReturnType<typeof installCheckoutBrowserPlatform>;

beforeEach(() => {
  router = routeCheckoutFetch();
  vi.stubGlobal("fetch", router.fetchMock);
  platform = installCheckoutBrowserPlatform();
});

afterEach(() => {
  cleanup();
  platform.restore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkout age-priced visitor counters", () => {
  it("adds $10 per youth and admits children 0-7 free", () => {
    renderCheckout();
    expect(partyTotal("Estimated total")).toBe("$40");

    click("More youths");
    expect(partyTotal("Total visitors")).toBe("3");
    expect(partyTotal("Estimated total")).toBe("$50");

    click("More children");
    expect(partyTotal("Total visitors")).toBe("4");
    expect(partyTotal("Estimated total")).toBe("$50");
  });

  it("caps the order at 30 visitors including free children", () => {
    renderCheckout();
    click("More children", 28);
    expect(partyTotal("Total visitors")).toBe("30");
    expect(partyTotal("Estimated total")).toBe("$40");
    expect(screen.getByRole("button", { name: "More adults" }).getAttribute("aria-disabled")).toBe("true");

    click("More adults");
    click("More children");
    expect(partyTotal("Total visitors")).toBe("30");
    expect(screen.getByRole("status").textContent).toBe(
      "An order can include up to 30 visitors, including children."
    );
  });

  it("keeps at least one adult on the order", () => {
    renderCheckout();
    click("Fewer adults", 2);
    expect(partyTotal("Total visitors")).toBe("1");
    expect(screen.getByRole("button", { name: "Fewer adults" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Each order needs at least 1 Adult 18+.");
  });

  it("checks availability for every visitor, free children included, and sends them with the review", async () => {
    router.queue.push(Response.json({ error: "stop" }, { status: 503 }));
    renderCheckout();

    click("More youths");
    click("More children", 2);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "guest@example.com" } });
    const review = screen.getByRole("button", { name: "Review Order" }) as HTMLButtonElement;
    await waitFor(() => expect(review.disabled).toBe(false));
    expect(String(router.availabilityCalls().at(-1)?.[0])).toContain("party=5");
    click("Review Order");

    await waitFor(() => expect(router.orderCalls()).toHaveLength(1));
    const [url, init] = router.orderCalls()[0];
    expect(url).toBe("/api/order-drafts/checkout");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      adults: 2,
      children: 1,
      freeChildren: 2,
      entryTime: "09:00"
    });
  });
});

describe("local admission preview gate", () => {
  it.each([
    ["production with the flag", { NODE_ENV: "production", SKYLA_LOCAL_ADMISSION_PREVIEW: "1" }, false],
    ["Vercel development with the flag", { NODE_ENV: "development", VERCEL: "1", SKYLA_LOCAL_ADMISSION_PREVIEW: "1" }, false],
    ["local development without the flag", { NODE_ENV: "development" }, false],
    ["local development with the flag", { NODE_ENV: "development", SKYLA_LOCAL_ADMISSION_PREVIEW: "1" }, true]
  ] as const)("is %s => %s", (_label, env, enabled) => {
    expect(localAdmissionPreviewEnabled(env)).toBe(enabled);
  });

  async function renderPage() {
    return renderToStaticMarkup(await CheckoutPage({ searchParams: Promise.resolve({}) }));
  }

  it.each([
    ["production", { NODE_ENV: "production" }],
    ["Vercel", { NODE_ENV: "development", VERCEL: "1" }]
  ])("keeps the locked page on %s even with the preview flag", async (_label, env) => {
    expect(siteConfig.launched).toBe(false);
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("SKYLA_LOCAL_ADMISSION_PREVIEW", "1");

    const html = await renderPage();
    expect(html).toContain("Individual tickets are not available.");
    expect(html).not.toContain("Visitors");
    expect(html).not.toContain("Local preview only");
  });

  it("renders the form locally with one preview notice and no launch banner", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("SKYLA_LOCAL_ADMISSION_PREVIEW", "1");

    const html = await renderPage();
    expect(html.match(/Local preview only/g)).toHaveLength(1);
    expect(html).not.toContain('class="launchBanner"');
    expect(html).toContain("<legend>Visitors</legend>");
    expect(html).toContain('href="/#venue-booking"');
  });
});
