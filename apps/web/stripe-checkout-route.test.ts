import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-checkout/route";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "stripe-gateway-test-secret-32-chars";

function expectPaymentHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBeNull();
}

function request(body: unknown, init?: RequestInit) {
  return new Request("https://skydeckla.com/api/payments/stripe-checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.12",
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
  fetchMock.mockReset();
});

describe("/api/payments/stripe-checkout", () => {
  it("fails closed when Convex is not configured", async () => {
    const response = await POST(
      request({
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123"
      })
    );

    expect(response.status).toBe(503);
    expectPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "payment_service_unavailable"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires orderRef and idempotencyKey before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;

    const response = await POST(request({ orderRef: "SKY2607-ABC123" }));

    expect(response.status).toBe(400);
    expectPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotencyKey is required",
      code: "invalid_payment_request"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces server configuration failures as unavailable", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      { ok: false, code: "service_unavailable", error: "The service is temporarily unavailable" },
      { status: 503 }
    ));

    const response = await POST(
      request({
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123"
      })
    );

    expect(response.status).toBe(503);
    expectPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Checkout is not available right now",
      code: "payment_service_unavailable"
    });
    expect(JSON.stringify(body)).not.toContain("SKYLA_STRIPE_MODE");
  });

  it("treats missing Stripe return-origin allowlist as server configuration", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      { ok: false, code: "service_unavailable", error: "The service is temporarily unavailable" },
      { status: 503 }
    ));

    const response = await POST(
      request({
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123"
      })
    );

    expect(response.status).toBe(503);
    expectPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Checkout is not available right now",
      code: "payment_service_unavailable"
    });
    expect(JSON.stringify(body)).not.toContain("SKYLA_PAYMENT_RETURN_ORIGINS");
  });

  it("starts Stripe Checkout through the Convex action with generated return URLs", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      result: {
        orderRef: "SKY2607-ABC123",
        provider: "stripe",
        checkoutSessionId: "cs_test_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        amountCents: 5800,
        currency: "usd",
        clientSecret: "cs_test_secret_should_not_return",
        client_secret: "cs_test_secret_should_not_return"
      }
    }));

    const response = await POST(
      request(
        {
          orderRef: "SKY2607-ABC123",
          idempotencyKey: "checkout_20260704_abc123",
          amountCents: 1
        },
        { headers: { origin: "https://www.skydeckla.com" } }
      )
    );

    expect(response.status).toBe(200);
    expectPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      amountCents: 5800
    });
    expect(JSON.stringify(body)).not.toContain("clientSecret");
    expect(JSON.stringify(body)).not.toContain("client_secret");
    expect(JSON.stringify(body)).not.toContain("should_not_return");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.convex.site/public-gateway");
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "stripe-checkout",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: {
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123",
        successUrl:
          "https://www.skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://www.skydeckla.com/checkout?stripe=cancel"
      }
    });
  });

  it("forwards durable Stripe rate limits with no-store payment headers", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "rate_limited",
        error: "Too many requests. Please try again later.",
        retryAfterSeconds: 120
      },
      { status: 429 }
    ));

    const response = await POST(request({
      orderRef: "SKY2607-ABC123",
      idempotencyKey: "checkout_20260704_abc123"
    }));

    expect(response.status).toBe(429);
    expectPaymentHeaders(response);
    expect(response.headers.get("retry-after")).toBe("120");
    await expect(response.json()).resolves.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 120
    });
  });
});
