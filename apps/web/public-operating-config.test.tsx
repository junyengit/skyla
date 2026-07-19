import { renderToStaticMarkup } from "react-dom/server";
import { fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VisitorOperatingConfig } from "./app/page";
import {
  loadPublicOperatingConfig,
  unavailablePublicOperatingConfig
} from "./lib/public-operating-config";
import type { OperatingHours, PublicOperatingConfig } from "./lib/operating-hours";

const { unstableCacheMock } = vi.hoisted(() => ({
  unstableCacheMock: vi.fn((loader: (...args: unknown[]) => unknown) => loader)
}));

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: unstableCacheMock }));

const fetchQueryMock = vi.mocked(fetchQuery);
const operatingHours: OperatingHours = {
  Monday: { open: "11:00", close: "19:00", closed: false },
  Tuesday: { open: "11:00", close: "19:00", closed: false },
  Wednesday: { open: "11:00", close: "19:00", closed: false },
  Thursday: { open: "11:00", close: "19:00", closed: false },
  Friday: { open: "11:00", close: "21:00", closed: false },
  Saturday: { open: "10:00", close: "21:00", closed: false },
  Sunday: { open: "10:00", close: "18:00", closed: false }
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("public operating config server bridge", () => {
  it("uses a bounded Next cache boundary", () => {
    expect(unstableCacheMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["skyla-public-operating-config"],
      { revalidate: 60 }
    );
  });

  it("serves the venue-hours fallback without Convex and does not attempt a query", async () => {
    await expect(loadPublicOperatingConfig()).resolves.toEqual(unavailablePublicOperatingConfig);
    expect(unavailablePublicOperatingConfig.announcement?.text).toContain("temporarily unavailable");
    expect(unavailablePublicOperatingConfig.operatingHours.Monday).toEqual({
      open: "09:00",
      close: "18:00",
      closed: false
    });
    expect(unavailablePublicOperatingConfig.operatingHours.Saturday).toEqual({
      open: "10:00",
      close: "22:00",
      closed: false
    });
    expect(unavailablePublicOperatingConfig.operatingHours.Sunday).toEqual({
      open: "10:00",
      close: "22:00",
      closed: false
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("loads and validates the public projection without a staff token", async () => {
    process.env.CONVEX_URL = "https://example.convex.cloud";
    const projection: PublicOperatingConfig = {
      announcement: { text: "Sunset hours this weekend.", type: "info" },
      operatingHours,
      timeZone: "America/Los_Angeles"
    };
    fetchQueryMock.mockResolvedValueOnce(projection);

    await expect(loadPublicOperatingConfig()).resolves.toEqual(projection);
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      {},
      { url: "https://example.convex.cloud" }
    );
  });

  it("fails closed for query failures or malformed projections", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("deployment unavailable"));
    await expect(loadPublicOperatingConfig()).resolves.toEqual(unavailablePublicOperatingConfig);

    fetchQueryMock.mockResolvedValueOnce({ operatingHours: {}, timeZone: "UTC" });
    await expect(loadPublicOperatingConfig()).resolves.toEqual(unavailablePublicOperatingConfig);
    expect(unavailablePublicOperatingConfig.announcement?.type).toBe("warning");
  });
});

describe("guest operating information", () => {
  it("renders the active announcement as escaped text with operating hours", () => {
    const html = renderToStaticMarkup(
      <VisitorOperatingConfig
        config={{
          announcement: { text: "<img src=x onerror=alert(1)>", type: "warning" },
          operatingHours,
          timeZone: "America/Los_Angeles"
        }}
      />
    );

    expect(html).toContain("Guest notice");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("Monday:");
    expect(html).toContain("11:00 AM - 7:00 PM");
  });

  it("renders the service warning with venue hours when the backend is unavailable", () => {
    const html = renderToStaticMarkup(
      <VisitorOperatingConfig config={unavailablePublicOperatingConfig} />
    );

    expect(html).toContain("Online booking is temporarily unavailable");
    expect(html).toContain("Monday:");
    expect(html).toContain("9:00 AM - 6:00 PM");
    expect(html).toContain("Saturday:");
    expect(html).toContain("10:00 AM - 10:00 PM");
  });
});
