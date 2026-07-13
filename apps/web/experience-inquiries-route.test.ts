import { afterEach, describe, expect, it, vi } from "vitest";

const route = await import("./app/api/experiences/inquiries/route");
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "inquiry-gateway-test-secret-32-chars";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://skydeckla.com/api/experiences/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.10"
    },
    body: JSON.stringify(body)
  });
}

describe("/api/experiences/inquiries", () => {
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
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0001"
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
        firstName: "Jane",
        lastName: "Smith",
        email: "not-an-email",
        experience: "vip-only",
        eventDate: "07/10/2026",
        guestCount: "900",
        idempotencyKey: "short"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("valid email");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a normalized durable inquiry request", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      result: {
        inquiryId: "inquiry_123",
        emailLower: "jane@example.com",
        experience: "champagne-room",
        eventDate: "2026-07-10",
        guestCount: "9-12",
        status: "pending",
        createdAt: 1782960000000,
        replayed: false
      }
    }));


    const response = await route.POST(
      postRequest({
        firstName: " Jane ",
        lastName: " Smith ",
        email: " Jane@Example.com ",
        experience: "champagne-room",
        eventDate: "2026-07-10",
        guestCount: "9-12",
        notes: "  Window timing, please  ",
        source: " native-experiences ",
        status: "approved",
        createdAt: 1,
        idempotencyKey: "inquiry_apply_0002"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.inquiry).toMatchObject({ inquiryId: "inquiry_123", status: "pending" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.convex.site/public-gateway");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${gatewaySecret}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "experience-inquiry",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: {
        firstName: "Jane",
        lastName: "Smith",
        email: "Jane@Example.com",
        experience: "champagne-room",
        eventDate: "2026-07-10",
        guestCount: "9-12",
        notes: "Window timing, please",
        source: "native-experiences",
        idempotencyKey: "inquiry_apply_0002"
      }
    });
    expect(String(init?.body)).not.toContain("203.0.113.10");
  });

  it("returns conflict when the idempotency key is reused for a different inquiry", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "request_conflict",
        error: "idempotencyKey was already used for a different inquiry"
      },
      { status: 409 }
    ));

    const response = await route.POST(
      postRequest({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0003"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("different inquiry");
  });

  it("returns a durable rate-limit response without exposing gateway internals", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "rate_limited",
        error: "Too many requests. Please try again later.",
        retryAfterSeconds: 90
      },
      { status: 429, headers: { "Retry-After": "90" } }
    ));

    const response = await route.POST(postRequest({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      experience: "date-night",
      eventDate: "2026-07-10",
      guestCount: "2",
      idempotencyKey: "inquiry_apply_0004"
    }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(data).toMatchObject({ code: "rate_limited", retryAfterSeconds: 90 });
    expect(JSON.stringify(data)).not.toContain(gatewaySecret);
  });
});
