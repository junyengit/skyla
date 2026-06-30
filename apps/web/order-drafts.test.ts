import { fetchMutation } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/order-drafts/checkout/route";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

const fetchMutationMock = vi.mocked(fetchMutation);

function request(body: unknown) {
  return new Request("http://localhost/api/order-drafts/checkout", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchMutationMock.mockReset();
});

describe("/api/order-drafts/checkout", () => {
  it("returns transient canonical totals when Convex is not configured", async () => {
    const response = await POST(
      request({
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        totalCents: 1
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "convex_unconfigured",
      draft: {
        subtotalCents: 8100,
        feeCents: 405,
        totalCents: 8505
      }
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before using configured Convex persistence", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(request({ packageKey: "general", adults: 1 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "idempotencyKey_required",
      draft: {
        subtotalCents: 2900,
        feeCents: 145,
        totalCents: 3045
      }
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("persists through Convex when a deployment URL and idempotency key are present", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      orderRef: "SKY2607-ABC123",
      status: "draft",
      totals: {
        currency: "usd",
        subtotalCents: 8100,
        feeCents: 405,
        totalCents: 8505
      },
      customerEmail: "guest@example.com",
      lines: [
        {
          kind: "ticket",
          productKey: "general",
          name: "General Admission",
          quantity: 2,
          unitAmountCents: 2900,
          lineTotalCents: 5800
        }
      ]
    });

    const response = await POST(
      request({
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        customerEmail: "GUEST@EXAMPLE.COM",
        idempotencyKey: "checkout_20260704_abc123",
        totalCents: 1
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: true,
      orderRef: "SKY2607-ABC123",
      draft: {
        orderRef: "SKY2607-ABC123",
        subtotalCents: 8100,
        feeCents: 405,
        totalCents: 8505,
        customerEmail: "guest@example.com"
      }
    });
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        customerEmail: "GUEST@EXAMPLE.COM",
        source: "next-route",
        idempotencyKey: "checkout_20260704_abc123"
      },
      { url: "https://example.convex.cloud" }
    );
  });

  it("returns conflict when Convex rejects idempotency reuse for a different draft", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(new Error("idempotencyKey was already used for a different draft"));

    const response = await POST(
      request({
        packageKey: "general",
        adults: 1,
        idempotencyKey: "checkout_20260704_abc123"
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      error: "idempotencyKey was already used for a different draft"
    });
  });

  it("rejects inactive package selections", async () => {
    const response = await POST(request({ packageKey: "champagne-room", adults: 2 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Ticket package is not bookable"
    });
  });
});
