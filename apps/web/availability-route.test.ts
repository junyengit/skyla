import { fetchQuery } from "convex/nextjs";
import { siteConfig } from "@skyla/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./app/api/availability/route";
import { availabilityPayload } from "./checkout-test-support";

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));

const fetchQueryMock = vi.mocked(fetchQuery);

function request(query: string) {
  return new Request(`https://skydeckla.com/api/availability?${query}`);
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("/api/availability", () => {
  it.each([
    ["a missing date", "party=2", "date must be a real YYYY-MM-DD date"],
    ["an impossible date", "date=2026-02-30&party=2", "date must be a real YYYY-MM-DD date"],
    ["a zero party", "date=2026-10-03&party=0", "party must be a whole number from 1 to 30"],
    ["a party over 30", "date=2026-10-03&party=31", "party must be a whole number from 1 to 30"],
    ["a fractional party", "date=2026-10-03&party=2.5", "party must be a whole number from 1 to 30"]
  ])("rejects %s before reading Convex", async (_label, query, error) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error, code: "invalid_request" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured", async () => {
    const response = await GET(request("date=2026-10-03&party=2"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "availability_unavailable" });
  });

  it("stays read-only and available while ticket sales are switched off", async () => {
    expect(siteConfig.launched).toBe(false);
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      ...availabilityPayload("2026-10-03", 4, { today: "2026-10-02" }),
      orderRef: "SKY2610-LEAK",
      customerEmail: "leak@example.com",
      slots: availabilityPayload("2026-10-03", 4).slots.map((slot) => ({ ...slot, bookingRef: "SKY2610-LEAK" }))
    });

    const response = await GET(request("date=2026-10-03&party=4"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual(availabilityPayload("2026-10-03", 4, { today: "2026-10-02" }));
    expect(JSON.stringify(body)).not.toContain("LEAK");
    expect(JSON.stringify(body)).not.toContain("leak@example.com");
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { visitDate: "2026-10-03", partySize: 4 },
      { url: "https://example.convex.cloud" }
    );
  });

  it("rejects a malformed or mismatched server projection", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce(availabilityPayload("2026-10-04", 4));

    const response = await GET(request("date=2026-10-03&party=4"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "availability_invalid" });
  });

  it("reports an unavailable read without exposing the error", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("internal detail"));

    const response = await GET(request("date=2026-10-03&party=4"));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "availability_unavailable" });
    expect(JSON.stringify(body)).not.toContain("internal detail");
  });
});
