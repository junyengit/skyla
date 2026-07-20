import { fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-terminal/status/route";

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));

const fetchQueryMock = vi.mocked(fetchQuery);

function request(body: unknown = { saleRef: "SALE260713-ABC123" }, token = "staff.jwt") {
  return new Request("https://skydeckla.com/api/payments/stripe-terminal/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("/api/payments/stripe-terminal/status", () => {
  it("requires staff authentication before reading sale state", async () => {
    const response = await POST(request(undefined, ""));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed without Convex", async () => {
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("returns the server receipt and ticket identity with the bearer token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      saleRef: "SALE260713-ABC123",
      status: "paid",
      currency: "usd",
      subtotalCents: 2000,
      feeCents: 0,
      totalCents: 2000,
      paymentStatus: "paid",
      lines: [{ kind: "ticket", name: "The View", quantity: 1, unitAmountCents: 2000, lineTotalCents: 2000 }],
      bookingRef: "SALE260713-ABC123",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      updatedAt: 123
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(body).toMatchObject({ status: "paid", totalCents: 2000, bookingRef: "SALE260713-ABC123" });
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { saleRef: "SALE260713-ABC123" },
      { url: "https://example.convex.cloud", token: "staff.jwt" }
    );
  });

  it("uses a not-found error contract when the authoritative sale is absent", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("POS sale was not found"));

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "pos_sale_not_found" });
  });
});
