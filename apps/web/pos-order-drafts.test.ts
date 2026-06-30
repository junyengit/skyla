import { fetchMutation } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/order-drafts/pos/route";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

const fetchMutationMock = vi.mocked(fetchMutation);

function request(body: unknown, init?: RequestInit) {
  return new Request("http://localhost/api/order-drafts/pos", {
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
  fetchMutationMock.mockReset();
});

describe("/api/order-drafts/pos", () => {
  it("returns canonical POS totals and ignores spoofed browser totals", async () => {
    const response = await POST(
      request({
        amountCents: 1,
        totalCents: 1,
        lines: [
          { kind: "ticket", packageKey: "drink", quantity: 2, unitAmountCents: 1 },
          { kind: "cafe", itemKey: "b1", quantity: 3, priceCents: 1 },
          { kind: "custom", name: "Service recovery", amountCents: 500, quantity: 1, reason: "Manager approved" }
        ],
        customerEmail: "GUEST@EXAMPLE.COM"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "convex_unconfigured",
      draft: {
        channel: "pos",
        subtotalCents: 9700,
        feeCents: 0,
        totalCents: 9700,
        customerEmail: "guest@example.com",
        lines: [
          {
            kind: "ticket",
            productKey: "drink",
            name: "Deck + Drink",
            quantity: 2,
            unitAmountCents: 3700,
            lineTotalCents: 7400
          },
          {
            kind: "cafe",
            productKey: "b1",
            name: "Butter Croissant",
            quantity: 3,
            unitAmountCents: 600,
            lineTotalCents: 1800
          },
          {
            kind: "custom",
            name: "Service recovery",
            quantity: 1,
            unitAmountCents: 500,
            lineTotalCents: 500
          }
        ]
      }
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("requires staff auth before using configured Convex persistence", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(
      request({
        lines: [{ kind: "ticket", packageKey: "general", quantity: 1 }],
        idempotencyKey: "pos_20260704_abc123"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "staff_auth_required",
      draft: {
        subtotalCents: 2900,
        feeCents: 0,
        totalCents: 2900
      }
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("persists through Convex when deployment URL, idempotency key, and staff token are present", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      saleRef: "SALE260704-ABC123",
      status: "draft",
      totals: {
        currency: "usd",
        subtotalCents: 2900,
        feeCents: 0,
        totalCents: 2900
      },
      customerEmail: "guest@example.com",
      readerId: "tmr_123",
      lines: [
        {
          kind: "ticket",
          productKey: "general",
          name: "General Admission",
          quantity: 1,
          unitAmountCents: 2900,
          lineTotalCents: 2900
        }
      ]
    });

    const response = await POST(
      request(
        {
          lines: [{ kind: "ticket", packageKey: "general", quantity: 1 }],
          customerEmail: "GUEST@EXAMPLE.COM",
          readerId: "tmr_123",
          idempotencyKey: "pos_20260704_abc123",
          totalCents: 1
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: true,
      saleRef: "SALE260704-ABC123",
      draft: {
        saleRef: "SALE260704-ABC123",
        subtotalCents: 2900,
        feeCents: 0,
        totalCents: 2900
      }
    });
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        lines: [{ kind: "ticket", packageKey: "general", quantity: 1 }],
        customerEmail: "guest@example.com",
        readerId: "tmr_123",
        idempotencyKey: "pos_20260704_abc123"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("rejects malformed POS lines", async () => {
    const emptyResponse = await POST(request({ lines: [] }));

    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toMatchObject({
      error: "POS sale requires at least one line"
    });

    const customResponse = await POST(
      request({
        lines: [{ kind: "custom", name: "Custom", amountCents: 500 }]
      })
    );

    expect(customResponse.status).toBe(400);
    await expect(customResponse.json()).resolves.toMatchObject({
      error: "Custom charge requires a reason"
    });
  });
});
