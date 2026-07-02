import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchQuery } = await import("convex/nextjs");
const route = await import("./app/api/admin/operations/route");

function request(headers?: HeadersInit, url = "https://skydeckla.test/api/admin/operations") {
  return new Request(url, { headers });
}

describe("admin operations route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff bearer auth before checking configuration", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ code: "staff_auth_required" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request({ Authorization: "Bearer staff_token" }));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("requires staff bearer auth before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(request());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ code: "staff_auth_required" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("forwards token and bounded limit to the staff-gated Convex query", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "admin" },
      readiness: {
        stripeSecret: true,
        stripeWebhookSecret: false,
        terminalReaderRegistry: false,
        paymentReturnOrigins: true
      },
      counts: {
        draftOrders: { value: 1, capped: false },
        pendingOrders: { value: 2, capped: false },
        draftPosSales: { value: 3, capped: false },
        pendingPosSales: { value: 4, capped: false },
        pendingMembers: { value: 5, capped: false },
        approvedMembers: { value: 6, capped: false }
      },
      recent: { orders: [], posSales: [], paymentEvents: [], bookings: [], members: [] }
    });

    const response = await route.GET(
      request({ Authorization: "Bearer staff_token" }, "https://skydeckla.test/api/admin/operations?limit=8")
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.staff.emailLower).toBe("ops@example.com");
    expect(fetchQuery).toHaveBeenCalledWith(
      "admin:getOperationsSnapshot",
      { limit: 8 },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("rejects unbounded limits", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(
      request({ Authorization: "Bearer staff_token" }, "https://skydeckla.test/api/admin/operations?limit=100")
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("limit must");
    expect(fetchQuery).not.toHaveBeenCalled();
  });
});
