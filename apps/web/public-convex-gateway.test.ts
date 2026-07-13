import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callPublicConvexGateway,
  convexSiteUrl,
  PublicGatewayError,
  trustedClientAddress
} from "./lib/public-convex-gateway";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "public-gateway-test-secret-32-characters";

afterEach(() => {
  delete process.env.CONVEX_SITE_URL;
  delete process.env.CONVEX_URL;
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
  delete process.env.VERCEL;
  fetchMock.mockReset();
});

describe("public Convex gateway client", () => {
  it("derives the Convex HTTP origin without accepting an arbitrary cloud URL", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    expect(convexSiteUrl()).toBe("https://example.convex.site");

    process.env.CONVEX_URL = "https://attacker.example";
    expect(() => convexSiteUrl()).toThrow(PublicGatewayError);
  });

  it("restricts an explicit gateway URL to Convex sites or local loopback", () => {
    process.env.CONVEX_SITE_URL = "https://attacker.example";
    expect(() => convexSiteUrl()).toThrowError(
      expect.objectContaining({ code: "public_gateway_unconfigured", status: 503 })
    );

    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    expect(convexSiteUrl()).toBe("https://example.convex.site");

    process.env.CONVEX_SITE_URL = "http://127.0.0.1:3212";
    expect(convexSiteUrl()).toBe("http://127.0.0.1:3212");
  });

  it("requires Vercel's spoof-resistant client address in production", () => {
    process.env.VERCEL = "1";
    const request = new Request("https://skydeckla.com/api/example", {
      headers: { "x-forwarded-for": "203.0.113.99" }
    });
    expect(() => trustedClientAddress(request)).toThrowError(
      expect.objectContaining({ code: "trusted_client_address_unavailable", status: 503 })
    );
  });

  it("sends only an HMAC pseudonym and maps durable quota responses", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    const request = new Request("https://skydeckla.com/api/example", {
      headers: { "x-vercel-forwarded-for": "203.0.113.25" }
    });
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "rate_limited",
        error: "Too many requests. Please try again later.",
        retryAfterSeconds: 75
      },
      { status: 429 }
    ));

    await expect(callPublicConvexGateway(request, "checkout-draft", { adults: 2 })).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 75
    });
    const [url, init] = fetchMock.mock.calls[0];
    const body = String(init?.body);
    expect(url).toBe("https://example.convex.site/public-gateway");
    expect(JSON.parse(body)).toMatchObject({
      operation: "checkout-draft",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: { adults: 2 }
    });
    expect(body).not.toContain("203.0.113.25");
    expect(body).not.toContain(gatewaySecret);
  });

  it("fails closed before network access when the shared secret is absent", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const request = new Request("https://skydeckla.com/api/example", {
      headers: { "x-vercel-forwarded-for": "203.0.113.25" }
    });

    await expect(callPublicConvexGateway(request, "experience-inquiry", {})).rejects.toMatchObject({
      code: "public_gateway_unconfigured",
      status: 503
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
