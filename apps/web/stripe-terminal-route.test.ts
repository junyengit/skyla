import { fetchAction } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-terminal/route";

vi.mock("convex/nextjs", () => ({
  fetchAction: vi.fn()
}));

const fetchActionMock = vi.mocked(fetchAction);

function request(body: unknown, init?: RequestInit) {
  return new Request("https://skydeckla.com/api/payments/stripe-terminal", {
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

describe("/api/payments/stripe-terminal", () => {
  it("fails closed when Convex is not configured", async () => {
    const response = await POST(
      request({
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("requires staff auth before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(
      request({
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("requires saleRef and idempotencyKey before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(
      request({ saleRef: "SALE260704-ABC123" }, { headers: { authorization: "Bearer staff.jwt.token" } })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotencyKey is required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("starts Stripe Terminal through the Convex action with staff auth and no browser amount", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchActionMock.mockResolvedValueOnce({
      saleRef: "SALE260704-ABC123",
      provider: "terminal",
      paymentIntentId: "pi_test_123",
      clientSecret: "pi_test_123_secret_abc",
      amountCents: 2900,
      currency: "usd",
      status: "requires_payment_method"
    });

    const response = await POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123",
          amountCents: 1,
          readerId: "tmr_browser_supplied"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      paymentIntentId: "pi_test_123",
      clientSecret: "pi_test_123_secret_abc",
      amountCents: 2900
    });
    expect(fetchActionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });
});
