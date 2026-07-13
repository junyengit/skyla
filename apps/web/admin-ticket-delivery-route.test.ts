import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchMutation } = await import("convex/nextjs");
const route = await import("./app/api/admin/bookings/ticket-delivery/route");

function postRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://skydeckla.test/api/admin/bookings/ticket-delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("admin ticket delivery route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff bearer auth before checking Convex configuration", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.POST(postRequest({ bookingRef: "SKY2607-ABC123" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "staff_auth_required" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.POST(
      postRequest({ bookingRef: "SKY2607-ABC123" }, { Authorization: "Bearer staff_token" })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("queues an admin-authorized resend with the staff token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      bookingRef: "SKY2607-ABC123",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      status: "queued",
      attemptCount: 1,
      sendVersion: 2,
      updatedAt: 1782960000000
    });

    const response = await route.POST(
      postRequest({ bookingRef: " SKY2607-ABC123 " }, { Authorization: "Bearer staff_token" })
    );

    expect(response.status).toBe(200);
    expect((await response.json()).delivery.status).toBe("queued");
    expect(fetchMutation).toHaveBeenCalledWith(
      "ticketDelivery:requestTicketResend",
      { bookingRef: "SKY2607-ABC123" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("returns a conflict while the existing delivery attempt is active", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("Ticket delivery is already sending"));

    const response = await route.POST(
      postRequest({ bookingRef: "SKY2607-ABC123" }, { Authorization: "Bearer staff_token" })
    );

    expect(response.status).toBe(409);
  });

  it("returns a bad request for malformed JSON", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const request = new Request("https://skydeckla.test/api/admin/bookings/ticket-delivery", {
      method: "POST",
      headers: {
        Authorization: "Bearer staff_token",
        "Content-Type": "application/json"
      },
      body: "{"
    });

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(fetchMutation).not.toHaveBeenCalled();
  });
});
