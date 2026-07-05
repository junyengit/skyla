import { fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./app/api/pos/readers/route";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

const fetchQueryMock = vi.mocked(fetchQuery);

function request(init?: RequestInit) {
  return new Request("https://skydeckla.com/api/pos/readers", {
    method: "GET",
    headers: init?.headers
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("/api/pos/readers", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    const response = await GET(request({ headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("loads staff-authorized readers through Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: {
        emailLower: "pos@example.com",
        role: "pos"
      },
      readers: [
        {
          label: "Reader 1",
          readerId: "tmr_front_desk",
          terminalLocationId: "tml_lobby"
        }
      ]
    });

    const response = await GET(request({ headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      readers: [
        {
          label: "Reader 1",
          readerId: "tmr_front_desk",
          terminalLocationId: "tml_lobby"
        }
      ]
    });
    expect(fetchQueryMock).toHaveBeenCalledWith(expect.anything(), {}, {
      url: "https://example.convex.cloud",
      token: "staff.jwt.token"
    });
  });

  it("surfaces missing reader registry failures as unavailable", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("Trusted Terminal reader registry is not configured"));

    const response = await GET(request({ headers: { authorization: "Bearer staff.jwt.token" } }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Trusted Terminal reader registry is not configured"
    });
  });
});
