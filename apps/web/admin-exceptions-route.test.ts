import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchQuery } = await import("convex/nextjs");
const route = await import("./app/api/admin/exceptions/route");

function request(headers?: HeadersInit, url = "https://skydeckla.test/api/admin/exceptions") {
  return new Request(url, { headers });
}

describe("admin operations exceptions route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  });

  it("requires staff bearer auth before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "staff_auth_required" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("forwards bounded filters with the staff token and never caches", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockResolvedValueOnce({ status: "open", capped: false, exceptions: [] });

    const response = await route.GET(
      request({ Authorization: "Bearer staff_token" }, "https://skydeckla.test/api/admin/exceptions?status=open&limit=10")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(fetchQuery).toHaveBeenCalledWith(
      "operationsExceptions:listOperationsExceptions",
      { status: "open", limit: 10 },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it.each(["?limit=0", "?limit=51", "?status=all"])("rejects %s before calling Convex", async (query) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.GET(
      request({ Authorization: "Bearer staff_token" }, `https://skydeckla.test/api/admin/exceptions${query}`)
    );

    expect(response.status).toBe(400);
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("maps a forbidden staff role to 403", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockRejectedValueOnce(new Error("Staff role must be one of: admin, viewer"));

    const response = await route.GET(request({ Authorization: "Bearer staff_token" }));

    expect(response.status).toBe(403);
  });
});
