import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./app/ads-config.js/route";

const script = readFileSync(join(import.meta.dirname, "public", "ads-tracking.js"), "utf8");

const googleEnvKeys = [
  "NEXT_PUBLIC_GOOGLE_ADS_TAG_ID",
  "NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION",
  "NEXT_PUBLIC_GOOGLE_ADS_EVENT_LEAD_CONVERSION",
  "NEXT_PUBLIC_GOOGLE_ADS_MEMBERSHIP_LEAD_CONVERSION",
  "NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION"
] as const;

const originalEnv = Object.fromEntries(googleEnvKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of googleEnvKeys) {
    const original = originalEnv[key];
    if (original == null) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

function runTrackingScript(config?: unknown) {
  const appendedScripts: Array<{ async?: boolean; src?: string }> = [];
  const window = config ? { SKYLA_ADS: config } : {};
  const context = vm.createContext({
    Date,
    Number,
    encodeURIComponent,
    window,
    document: {
      createElement: () => ({}),
      head: {
        appendChild: (element: { async?: boolean; src?: string }) => appendedScripts.push(element)
      }
    }
  });

  vm.runInContext(script, context);
  return { appendedScripts, window: context.window as Record<string, any> };
}

function dataLayerCalls(window: Record<string, any>) {
  return (window.dataLayer || []).map((call: IArguments) => Array.from(call));
}

describe("Google Ads config route", () => {
  it("renders blank public config when Vercel env vars are unset", async () => {
    for (const key of googleEnvKeys) delete process.env[key];

    const response = GET();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(body).toContain('"googleTagId":""');
    expect(body).toContain('"purchase":""');
  });

  it("renders public Google Ads values from environment", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_TAG_ID = "AW-123456789";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION = "AW-123456789/purchase";

    const body = await GET().text();

    expect(body).toContain('"googleTagId":"AW-123456789"');
    expect(body).toContain('"purchase":"AW-123456789/purchase"');
  });
});

describe("ads-tracking.js", () => {
  it("stays inert when no Google Ads config is present", () => {
    const { appendedScripts, window } = runTrackingScript();

    expect(appendedScripts).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
    expect(window.SkylaAds).toBeDefined();

    window.SkylaAds.trackPurchase({ transactionId: "booking", value: 42 });
    expect(window.dataLayer).toBeUndefined();
  });

  it("loads gtag and emits purchase conversion events when configured", () => {
    const { appendedScripts, window } = runTrackingScript({
      googleTagId: "AW-123456789",
      conversions: {
        purchase: "AW-123456789/purchase"
      }
    });

    expect(appendedScripts).toEqual([
      expect.objectContaining({
        async: true,
        src: "https://www.googletagmanager.com/gtag/js?id=AW-123456789"
      })
    ]);

    window.SkylaAds.trackPurchase({
      transactionId: "SKY-123",
      value: 66.15,
      items: [{ item_name: "Deck + Drink", quantity: 2 }]
    });

    expect(dataLayerCalls(window)).toEqual([
      ["js", expect.any(Date)],
      ["config", "AW-123456789"],
      [
        "event",
        "purchase",
        {
          transaction_id: "SKY-123",
          currency: "USD",
          value: 66.15,
          items: [{ item_name: "Deck + Drink", quantity: 2 }]
        }
      ],
      [
        "event",
        "conversion",
        {
          send_to: "AW-123456789/purchase",
          transaction_id: "SKY-123",
          currency: "USD",
          value: 66.15
        }
      ]
    ]);
  });
});
