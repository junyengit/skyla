import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addons,
  admissionAgeCategories,
  admissionLineMetadata,
  catalogLineMetadata,
  ticketPackages
} from "@skyla/payments";

vi.mock("@skyla/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@skyla/config")>();
  return { ...original, siteConfig: { ...original.siteConfig, launched: true } };
});

import { POST } from "./app/api/order-drafts/checkout/route";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const gatewaySecret = "checkout-gateway-test-secret-32chars";

function request(body: unknown) {
  return new Request("http://localhost/api/order-drafts/checkout", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
  fetchMock.mockReset();
});

describe("/api/order-drafts/checkout", () => {
  it("returns transient canonical totals when no persistence key is requested", async () => {
    const response = await POST(
      request({
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        totalCents: 1,
        metadata: { catalogVersion: "browser-spoof" },
        catalogVersion: "browser-spoof"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "idempotencyKey_required",
      draft: {
        subtotalCents: 5800,
        feeCents: 0,
        totalCents: 5800,
        lines: [
          {
            kind: "ticket",
            productKey: "general",
            quantity: 2,
            unitAmountCents: 2000,
            metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.adult)
          },
          {
            kind: "ticket",
            productKey: "general",
            quantity: 1,
            unitAmountCents: 1000,
            metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.youth)
          },
          {
            kind: "addon",
            productKey: "matcha",
            metadata: catalogLineMetadata(addons.matcha)
          }
        ]
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when persistence is requested without the server gateway", async () => {
    const response = await POST(request({
      packageKey: "general",
      adults: 1,
      idempotencyKey: "checkout_20260704_missing"
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "public_gateway_unconfigured"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before using configured Convex persistence", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;

    const response = await POST(request({ packageKey: "general", adults: 1 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "idempotencyKey_required",
      draft: {
        subtotalCents: 2000,
        feeCents: 0,
        totalCents: 2000
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists through Convex when a deployment URL and idempotency key are present", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      result: {
        orderRef: "SKY2607-ABC123",
        status: "draft",
        totals: {
          currency: "usd",
          subtotalCents: 5800,
          feeCents: 0,
          totalCents: 5800
        },
        visitDate: "2026-07-18",
        entryTime: "14:00",
        customerEmail: "guest@example.com",
        expiresAt: 1784385000000,
        lines: [
          {
            kind: "ticket",
            productKey: "general",
            name: "The View",
            quantity: 2,
            unitAmountCents: 2000,
            lineTotalCents: 4000
          }
        ]
      }
    }));

    const response = await POST(
      request({
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        visitDate: "2026-07-18",
        entryTime: "14:00",
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
        subtotalCents: 5800,
        feeCents: 0,
        totalCents: 5800,
        visitDate: "2026-07-18",
        entryTime: "14:00",
        customerEmail: "guest@example.com",
        expiresAt: 1784385000000
      }
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "checkout-draft",
      rateLimitKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      input: {
        packageKey: "general",
        adults: 2,
        children: 1,
        addons: { matcha: 1 },
        visitDate: "2026-07-18",
        entryTime: "14:00",
        customerEmail: "GUEST@EXAMPLE.COM",
        source: "next-route",
        idempotencyKey: "checkout_20260704_abc123"
      }
    });
  });

  it("returns conflict when Convex rejects idempotency reuse for a different draft", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json(
      {
        ok: false,
        code: "request_conflict",
        error: "idempotencyKey was already used for a different draft"
      },
      { status: 409 }
    ));

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

  it("prices free children at zero and forwards them to Convex persistence", async () => {
    const transient = await POST(request({ packageKey: "general", adults: 1, children: 1, freeChildren: 2 }));
    const { draft } = await transient.json();
    expect(draft.totalCents).toBe(3000);
    expect(draft.lines).toContainEqual(expect.objectContaining({
      quantity: 2,
      unitAmountCents: 0,
      lineTotalCents: 0,
      metadata: expect.objectContaining({ ageCategory: "child" })
    }));

    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    fetchMock.mockResolvedValueOnce(Response.json({
      ok: true,
      result: {
        orderRef: "SKY2610-FREE01",
        status: "draft",
        totals: { currency: "usd", subtotalCents: 3000, feeCents: 0, totalCents: 3000 },
        expiresAt: 1791000000000,
        lines: draft.lines
      }
    }));

    const persisted = await POST(request({
      packageKey: "general",
      adults: 1,
      children: 1,
      freeChildren: 2,
      idempotencyKey: "checkout_20261002_free01"
    }));

    expect(persisted.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).input).toMatchObject({ adults: 1, children: 1, freeChildren: 2 });
  });

  it.each([
    ["fractional", { adults: 1, freeChildren: 0.5 }, "freeChildren must be a whole number from 0 to 30"],
    ["negative", { adults: 1, freeChildren: -1 }, "freeChildren must be a whole number from 0 to 30"],
    ["string", { adults: 1, freeChildren: "2" }, "freeChildren must be a whole number from 0 to 30"],
    ["over 30 visitors", { adults: 10, children: 10, freeChildren: 11 }, "party size must be 30 visitors or fewer"]
  ])("rejects %s free child counts before persistence", async (_label, party, error) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;

    const response = await POST(request({
      packageKey: "general",
      ...party,
      idempotencyKey: "checkout_20261002_bad001"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects inactive package selections", async () => {
    const response = await POST(request({ packageKey: "champagne-room", adults: 2 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Ticket package is not bookable"
    });
  });
});
