import { fetchAction } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-checkout/route";

vi.mock("convex/nextjs", () => ({
  fetchAction: vi.fn()
}));

const fetchActionMock = vi.mocked(fetchAction);

function expectPaymentHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBeNull();
}

function request(body: unknown, init?: RequestInit) {
  return new Request("https://skydeckla.com/api/payments/stripe-checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchActionMock.mockReset();
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
      code: "convex_unconfigured"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("requires orderRef and idempotencyKey before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(request({ orderRef: "SKY2607-ABC123" }));

    expect(response.status).toBe(400);
    expectPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotencyKey is required",
      code: "invalid_payment_request"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("surfaces server configuration failures as unavailable", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchActionMock.mockRejectedValueOnce(new Error("SKYLA_STRIPE_MODE is not configured"));

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
    fetchActionMock.mockRejectedValueOnce(
      new Error("SKYLA_PAYMENT_RETURN_ORIGINS must list at least one allowed Stripe return origin")
    );

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
    fetchActionMock.mockResolvedValueOnce({
      orderRef: "SKY2607-ABC123",
      provider: "stripe",
      checkoutSessionId: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      amountCents: 8505,
      currency: "usd",
      clientSecret: "cs_test_secret_should_not_return",
      client_secret: "cs_test_secret_should_not_return"
    });

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
      amountCents: 8505
    });
    expect(JSON.stringify(body)).not.toContain("clientSecret");
    expect(JSON.stringify(body)).not.toContain("client_secret");
    expect(JSON.stringify(body)).not.toContain("should_not_return");
    expect(fetchActionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123",
        successUrl:
          "https://www.skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://www.skydeckla.com/checkout?stripe=cancel"
      },
      { url: "https://example.convex.cloud" }
    );
  });
});
