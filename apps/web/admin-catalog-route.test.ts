import { fetchMutation, fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const route = await import("./app/api/admin/catalog/route");
const fetchQueryMock = vi.mocked(fetchQuery);
const fetchMutationMock = vi.mocked(fetchMutation);

function request(body?: unknown, init?: RequestInit, url = "https://skydeckla.test/api/admin/catalog") {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
  fetchMutationMock.mockReset();
});

describe("/api/admin/catalog", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    const response = await route.GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    const response = await route.GET(request(undefined, { headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("loads a catalog snapshot with an optional version filter", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "admin@example.com", role: "admin" },
      activeVersion: null,
      versions: [],
      currentProducts: [],
      snapshot: null
    });

    const response = await route.GET(
      request(
        undefined,
        { headers: { authorization: "Bearer staff.jwt.token" } },
        "https://skydeckla.test/api/admin/catalog?version=skyla-payments-catalog-2026-07-05"
      )
    );

    expect(response.status).toBe(200);
    expect(fetchQueryMock).toHaveBeenCalledWith(
      "catalog:getCatalogSnapshot",
      { version: "skyla-payments-catalog-2026-07-05" },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("rejects browser-submitted catalog prices before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.POST(
      request(
        {
          action: "seedCodeOwnedCatalog",
          prices: [{ key: "general", priceCents: 1 }]
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "catalog prices are code-owned and cannot be submitted by the browser"
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("seeds the code-owned catalog without accepting item payloads", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      version: "skyla-payments-catalog-2026-07-05",
      contentHash: "fnv1a32:abc:100",
      itemCount: 31,
      activeItemCount: 28,
      syncedProducts: 31,
      activatedAt: 1783292200000,
      created: true
    });

    const response = await route.POST(
      request(
        {
          action: "seedCodeOwnedCatalog",
          note: " initial seed "
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      catalog: {
        version: "skyla-payments-catalog-2026-07-05",
        syncedProducts: 31
      }
    });
    expect(fetchMutationMock).toHaveBeenCalledWith(
      "catalog:seedCodeOwnedCatalog",
      { note: "initial seed" },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("activates an existing version for audited rollback", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      version: "skyla-payments-catalog-2026-07-05",
      contentHash: "fnv1a32:abc:100",
      itemCount: 31,
      activeItemCount: 28,
      syncedProducts: 31,
      activatedAt: 1783292200000
    });

    const response = await route.POST(
      request(
        {
          action: "activateVersion",
          version: " skyla-payments-catalog-2026-07-05 ",
          note: " rollback "
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    expect(fetchMutationMock).toHaveBeenCalledWith(
      "catalog:activateCatalogVersion",
      {
        version: "skyla-payments-catalog-2026-07-05",
        note: "rollback"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });
});
