import { afterEach, describe, expect, it, vi } from "vitest";

const route = await import("./app/api/members/applications/route");
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "member-gateway-test-secret-32-chars";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://skydeckla.com/api/members/applications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.11"
    },
    body: JSON.stringify(body)
  });
}

describe("/api/members/applications", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;
  const originalGatewaySecret = process.env.SKYLA_PUBLIC_GATEWAY_SECRET;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = originalGatewaySecret;
  });

  it("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;
    delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;

    const response = await route.POST(
      postRequest({
        firstName: "Ari",
        lastName: "Stone",
        email: "ari@example.com",
        tier: "gold",
        idempotencyKey: "member_apply_0001"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "public_gateway_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid public input before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;

    const response = await route.POST(
      postRequest({
        firstName: "Ari",
        lastName: "Stone",
        email: "not-an-email",
        tier: "owner",
        idempotencyKey: "short"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("valid email");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a normalized durable application request", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      result: {
        memberId: "member_123",
        emailLower: "ari@example.com",
        tier: "gold",
        status: "pending",
        createdAt: 1782960000000,
        replayed: false
      }
    }));

    const response = await route.POST(
      postRequest({
        firstName: " Ari ",
        lastName: " Stone ",
        email: " Ari@Example.com ",
        phone: "   ",
        tier: "gold",
        source: " Referred by a current member ",
        bio: " Loves skyline evenings ",
        status: "approved",
        createdAt: 1,
        idempotencyKey: "member_apply_0002"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.member).toMatchObject({ memberId: "member_123", status: "pending" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "member-application",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: {
        firstName: "Ari",
        lastName: "Stone",
        email: "Ari@Example.com",
        tier: "gold",
        source: "Referred by a current member",
        bio: "Loves skyline evenings",
        idempotencyKey: "member_apply_0002"
      }
    });
  });

  it("returns conflict when the idempotency key is reused for a different application", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "request_conflict",
        error: "idempotencyKey was already used for a different member application"
      },
      { status: 409 }
    ));

    const response = await route.POST(
      postRequest({
        firstName: "Ari",
        lastName: "Stone",
        email: "ari@example.com",
        tier: "obsidian",
        idempotencyKey: "member_apply_0003"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("different member application");
  });
});
