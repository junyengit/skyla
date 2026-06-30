import { fetchAction } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-checkout/route";

vi.mock("convex/nextjs", () => ({
  fetchAction: vi.fn()
}));

const fetchActionMock = vi.mocked(fetchAction);

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
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("requires orderRef and idempotencyKey before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(request({ orderRef: "SKY2607-ABC123" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotencyKey is required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("starts Stripe Checkout through the Convex action with generated return URLs", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchActionMock.mockResolvedValueOnce({
      orderRef: "SKY2607-ABC123",
      provider: "stripe",
      checkoutSessionId: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      amountCents: 8505,
      currency: "usd"
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
    await expect(response.json()).resolves.toMatchObject({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      amountCents: 8505
    });
    expect(fetchActionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        orderRef: "SKY2607-ABC123",
        idempotencyKey: "checkout_20260704_abc123",
        successUrl:
          "https://www.skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}&order=SKY2607-ABC123",
        cancelUrl: "https://www.skydeckla.com/checkout?stripe=cancel&order=SKY2607-ABC123"
      },
      { url: "https://example.convex.cloud" }
    );
  });
});
