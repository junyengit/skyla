import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchQuery } = await import("convex/nextjs");
const route = await import("./app/api/admin/acceptance-readiness/route");

const fetchQueryMock = vi.mocked(fetchQuery);

function request(headers?: HeadersInit) {
  return new Request("https://skydeckla.test/api/admin/acceptance-readiness", { headers });
}

describe("admin acceptance readiness route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    fetchQueryMock.mockReset();
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
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request({ authorization: "Bearer staff.jwt.token" }));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("forwards staff auth to the Convex acceptance readiness query", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "pos@example.com", role: "pos" },
      stripe: {
        mode: "test",
        secretConfigured: true,
        paymentReturnOriginsConfigured: true,
        webhookSecretConfigured: true,
        checkoutReady: true
      },
      terminal: {
        readerRegistryConfigured: true,
        readerRegistryValid: true,
        readerCount: 1,
        acceptanceEnabled: false,
        readerProcessingReady: false
      }
    });

    const response = await route.GET(request({ authorization: "Bearer staff.jwt.token" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stripe.mode).toBe("test");
    expect(fetchQueryMock).toHaveBeenCalledWith(
      "admin:getAcceptanceReadiness",
      {},
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("maps Convex staff role failures to forbidden", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("Staff role must be one of: admin, pos"));

    const response = await route.GET(request({ authorization: "Bearer viewer.jwt.token" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Staff role must be one of: admin, pos"
    });
  });
});
