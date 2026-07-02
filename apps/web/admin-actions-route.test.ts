import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchMutation } = await import("convex/nextjs");
const bookingRoute = await import("./app/api/admin/bookings/status/route");
const memberRoute = await import("./app/api/admin/members/status/route");

function postRequest(path: string, body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request(`https://skydeckla.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("admin action routes", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff bearer auth before booking status configuration checks", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await bookingRoute.POST(
      postRequest("/api/admin/bookings/status", { bookingRef: "SKY2607-ABC123", status: "checked-in" })
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toMatchObject({ code: "staff_auth_required" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("fails closed when booking status Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await bookingRoute.POST(
      postRequest(
        "/api/admin/bookings/status",
        { bookingRef: "SKY2607-ABC123", status: "checked-in" },
        { Authorization: "Bearer staff_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("rejects arbitrary booking statuses before Convex mutation", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await bookingRoute.POST(
      postRequest(
        "/api/admin/bookings/status",
        { bookingRef: "SKY2607-ABC123", status: "delete-everything" },
        { Authorization: "Bearer staff_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("not recognized");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("forwards valid booking status changes with the staff token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      bookingRef: "SKY2607-ABC123",
      status: "checked-in",
      checkedInAt: 1782960000000
    });

    const response = await bookingRoute.POST(
      postRequest(
        "/api/admin/bookings/status",
        { bookingRef: " SKY2607-ABC123 ", status: "checked-in", note: " front desk " },
        { Authorization: "Bearer staff_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.booking.status).toBe("checked-in");
    expect(fetchMutation).toHaveBeenCalledWith(
      "admin:updateBookingStatus",
      { bookingRef: "SKY2607-ABC123", status: "checked-in", note: "front desk" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("omits blank optional action notes", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      bookingRef: "SKY2607-ABC123",
      status: "confirmed"
    });

    const response = await bookingRoute.POST(
      postRequest(
        "/api/admin/bookings/status",
        { bookingRef: "SKY2607-ABC123", status: "confirmed", note: "   " },
        { Authorization: "Bearer staff_token" }
      )
    );

    expect(response.status).toBe(200);
    expect(fetchMutation).toHaveBeenCalledWith(
      "admin:updateBookingStatus",
      { bookingRef: "SKY2607-ABC123", status: "confirmed" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("rejects arbitrary member statuses before Convex mutation", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await memberRoute.POST(
      postRequest(
        "/api/admin/members/status",
        { memberId: "member_123", status: "owner" },
        { Authorization: "Bearer staff_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("not recognized");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("forwards valid member status changes with the staff token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      memberId: "member_123",
      status: "approved",
      emailLower: "member@example.com"
    });

    const response = await memberRoute.POST(
      postRequest(
        "/api/admin/members/status",
        { memberId: "member_123", status: "approved" },
        { Authorization: "Bearer staff_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.member.status).toBe("approved");
    expect(fetchMutation).toHaveBeenCalledWith(
      "admin:updateMemberStatus",
      { memberId: "member_123", status: "approved" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });
});
