import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchQuery } = await import("convex/nextjs");
const route = await import("./app/api/admin/bookings/lookup/route");

function request(path: string, headers?: HeadersInit) {
  return new Request(`https://skydeckla.test${path}`, { headers });
}

describe("admin booking lookup route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff bearer auth before checking Convex configuration", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request("/api/admin/bookings/lookup?q=SKY2607-ABC123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ code: "staff_auth_required" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(
      request("/api/admin/bookings/lookup?q=SKY2607-ABC123", { Authorization: "Bearer staff_token" })
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("rejects empty lookup queries before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(request("/api/admin/bookings/lookup?q=++", { Authorization: "Bearer staff_token" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("q is required");
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("rejects unbounded lookup limits before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(
      request("/api/admin/bookings/lookup?q=guest@example.com&limit=99", { Authorization: "Bearer staff_token" })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("limit must");
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("forwards bounded booking lookups with the staff token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "pos" },
      query: "SKY2607-ABC123",
      matchType: "bookingRef",
      matches: [
        {
          bookingRef: "SKY2607-ABC123",
          status: "confirmed",
          emailLower: "guest@example.com",
          createdAt: 1782960000000
        }
      ]
    });

    const response = await route.GET(
      request("/api/admin/bookings/lookup?q=%20SKY2607-ABC123%20&limit=6", { Authorization: "Bearer staff_token" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.matches).toHaveLength(1);
    expect(fetchQuery).toHaveBeenCalledWith(
      "admin:lookupBookingForCheckIn",
      { query: "SKY2607-ABC123", limit: 6 },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });
});
