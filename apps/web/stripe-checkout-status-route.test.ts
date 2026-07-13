import { fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/payments/stripe-checkout/status/route";

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));

const fetchQueryMock = vi.mocked(fetchQuery);

function request(body: unknown = { checkoutSessionId: "cs_test_abc123xyz7890123" }) {
  return new Request("https://skydeckla.com/api/payments/stripe-checkout/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
});

describe("/api/payments/stripe-checkout/status", () => {
  it("fails closed and non-cacheable without Convex", async () => {
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("rejects incomplete return identities before Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_payment_request" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("returns only the authoritative allowlisted status", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      orderRef: "SKY2607-ABC123",
      status: "confirmed",
      bookingRef: "SKY2607-ABC123",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      emailLower: "must-not-leak@example.com",
      totalCents: 8505
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      orderRef: "SKY2607-ABC123",
      status: "confirmed",
      bookingRef: "SKY2607-ABC123",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef"
    });
    expect(JSON.stringify(body)).not.toContain("emailLower");
    expect(JSON.stringify(body)).not.toContain("totalCents");
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { checkoutSessionId: "cs_test_abc123xyz7890123" },
      { url: "https://example.convex.cloud" }
    );
  });

  it("maps an unknown session/order pair to a generic 404", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("Checkout payment was not found"));

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Checkout confirmation was not found",
      code: "checkout_not_found"
    });
  });
});
