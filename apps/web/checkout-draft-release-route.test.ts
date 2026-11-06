import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@skyla/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@skyla/config")>();
  return { ...original, siteConfig: { ...original.siteConfig, launched: true } };
});

import { POST } from "./app/api/order-drafts/checkout/release/route";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "release-gateway-test-secret-32-chars";

function request(body: unknown) {
  return new Request("https://skydeckla.com/api/order-drafts/checkout/release", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.12" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
  fetchMock.mockReset();
});

describe("/api/order-drafts/checkout/release (launched)", () => {
  it("forwards only the order identity through the trusted, rate-limited gateway", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: { released: true, status: "draft" } }));

    const response = await POST(request({ orderRef: "SKY2610-OLD", idempotencyKey: "checkout_old_key_0001", extra: "x" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ released: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.convex.site/public-gateway");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${gatewaySecret}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "checkout-draft-release",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: { orderRef: "SKY2610-OLD", idempotencyKey: "checkout_old_key_0001" }
    });
  });

  it("rejects a missing identity before calling the gateway", async () => {
    const response = await POST(request({ orderRef: "SKY2610-OLD" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
