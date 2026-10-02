import { fetchMutation } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admissionAgeCategories, admissionLineMetadata, cafeItems, catalogLineMetadata, ticketPackages } from "@skyla/payments";

import { POST } from "./app/api/order-drafts/pos/route";
import { POST as releasePost } from "./app/api/pos/sale-release/route";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

const fetchMutationMock = vi.mocked(fetchMutation);
const admission = { packageKey: "general", adults: 2, children: 1, freeChildren: 2, visitDate: "2026-10-03", entryTime: "14:00" };

function request(body: unknown, init?: RequestInit, path = "/api/order-drafts/pos") {
  return new Request(`http://localhost${path}`, {
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
  it("returns canonical mixed-age, cafe and custom totals and ignores spoofed browser prices", async () => {
    const response = await POST(
      request({
        amountCents: 1,
        totalCents: 1,
        admission: { ...admission, unitAmountCents: 1 },
        lines: [
          {
            kind: "cafe",
            itemKey: "b1",
            quantity: 3,
            priceCents: 1,
            catalogVersion: "browser-spoof"
          },
          {
            kind: "custom",
            name: "Service recovery",
            amountCents: 500,
            quantity: 1,
            reason: "Manager approved",
            metadata: { catalogAuthority: "browser-spoof" }
          }
        ],
        customerEmail: "GUEST@EXAMPLE.COM",
        readerId: "tmr_browser_supplied",
        terminalLocationId: "tml_browser_supplied"
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      persisted: false,
      persistenceReason: "convex_unconfigured",
      draft: {
        channel: "pos",
        subtotalCents: 7300,
        feeCents: 0,
        totalCents: 7300,
        customerEmail: "guest@example.com",
        visitDate: "2026-10-03",
        entryTime: "14:00",
        lines: [
          {
            kind: "ticket",
            name: "The View · Adult 18+",
            quantity: 2,
            unitAmountCents: 2000,
            lineTotalCents: 4000,
            metadata: admissionLineMetadata(ticketPackages.general, admissionAgeCategories.adult)
          },
          { kind: "ticket", quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000 },
          { kind: "ticket", quantity: 2, unitAmountCents: 0, lineTotalCents: 0 },
          {
            kind: "cafe",
            productKey: "b1",
            name: "Butter Croissant",
            quantity: 3,
            unitAmountCents: 600,
            lineTotalCents: 1800,
            metadata: catalogLineMetadata(cafeItems.b1)
          },
          {
            kind: "custom",
            name: "Service recovery",
            quantity: 1,
            unitAmountCents: 500,
            lineTotalCents: 500,
            metadata: { reason: "Manager approved" }
          }
        ]
      }
    });
    expect(body.draft.lines[4].metadata).toEqual({ reason: "Manager approved" });
    expect(body.draft).not.toHaveProperty("readerId");
    expect(body.draft).not.toHaveProperty("terminalLocationId");
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("requires staff auth before using configured Convex persistence", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(request({ admission: { ...admission, adults: 1, children: 0, freeChildren: 0 }, idempotencyKey: "pos_20260704_abc123" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: false,
      persistenceReason: "staff_auth_required",
      draft: { subtotalCents: 2000, feeCents: 0, totalCents: 2000 }
    });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("persists the selected visit and age counts through Convex with no browser Terminal location authority", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      saleRef: "SALE261002-ABC123",
      status: "draft",
      totals: { currency: "usd", subtotalCents: 5000, feeCents: 0, totalCents: 5000 },
      customerEmail: "guest@example.com",
      visitDate: "2026-10-03",
      entryTime: "14:00",
      readerId: "tmr_browser_supplied",
      terminalLocationId: "tml_registry_derived",
      expiresAt: 123,
      lines: []
    });

    const response = await POST(
      request(
        {
          admission,
          lines: [],
          customerEmail: "GUEST@EXAMPLE.COM",
          readerId: "tmr_browser_supplied",
          terminalLocationId: "tml_browser_supplied",
          idempotencyKey: "pos_20260704_abc123",
          totalCents: 1
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      persisted: true,
      saleRef: "SALE261002-ABC123",
      draft: { saleRef: "SALE261002-ABC123", visitDate: "2026-10-03", entryTime: "14:00", terminalLocationId: "tml_registry_derived" }
    });
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        admission,
        lines: [],
        customerEmail: "guest@example.com",
        readerId: "tmr_browser_supplied",
        idempotencyKey: "pos_20260704_abc123"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("returns the server's calendar or capacity refusal as a visit conflict", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(
      new Error("[CONVEX M(orderDrafts:createPosSaleDraft)] Uncaught Error: Visit unavailable: no places remain for that entry time\n    at handler")
    );

    const response = await POST(
      request({ admission, idempotencyKey: "pos_20260704_abc124" }, { headers: { authorization: "Bearer staff.jwt.token" } })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Visit unavailable: no places remain for that entry time",
      code: "visit_unavailable",
      persisted: false
    });
  });

  it.each([
    ["an empty sale", { lines: [] }, "POS sale requires at least one line"],
    ["a custom charge without a reason", { lines: [{ kind: "custom", name: "Custom", amountCents: 500 }] }, "Custom charge requires a reason"],
    ["an undated ticket line", { lines: [{ kind: "ticket", packageKey: "general", quantity: 1 }] }, "selected visit date"],
    ["admission without an adult", { admission: { ...admission, adults: 0 } }, "adults must be an integer from 1 to 30"],
    ["admission without a date", { admission: { ...admission, visitDate: "" } }, "visitDate is required"],
    ["a party over 30", { admission: { ...admission, adults: 30, children: 1 } }, "party size must be 30 visitors or fewer"],
    ["a fractional quantity", { lines: [{ kind: "cafe", itemKey: "b1", quantity: 1.5 }] }, "line quantity must be an integer"]
  ])("rejects %s", async (_label, body, message) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining(message) });
  });
});

describe("/api/pos/sale-release", () => {
  const releaseBody = { saleRef: "SALE261002-ABC123", idempotencyKey: "pos_20260704_abc123" };

  it("requires staff auth and Convex before releasing", async () => {
    const unauthenticated = await releasePost(request(releaseBody, undefined, "/api/pos/sale-release"));
    expect(unauthenticated.status).toBe(401);
    const unconfigured = await releasePost(
      request(releaseBody, { headers: { authorization: "Bearer staff.jwt" } }, "/api/pos/sale-release")
    );
    expect(unconfigured.status).toBe(503);
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("reports whether Convex released the draft without exposing anything else", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({ released: false, status: "payment_pending" });

    const response = await releasePost(
      request(releaseBody, { headers: { authorization: "Bearer staff.jwt" } }, "/api/pos/sale-release")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ released: false, status: "payment_pending" });
    expect(fetchMutationMock).toHaveBeenCalledWith(expect.anything(), releaseBody, {
      url: "https://example.convex.cloud",
      token: "staff.jwt"
    });
  });

  it("maps another cashier's sale to forbidden", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(new Error("POS sale belongs to a different staff user"));

    const response = await releasePost(
      request(releaseBody, { headers: { authorization: "Bearer staff.jwt" } }, "/api/pos/sale-release")
    );
    expect(response.status).toBe(403);
  });
});
