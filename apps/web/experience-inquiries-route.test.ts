import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchMutation } = await import("convex/nextjs");
const route = await import("./app/api/experiences/inquiries/route");

function postRequest(body: Record<string, unknown>) {
  return new Request("https://skydeckla.com/api/experiences/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/experiences/inquiries", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.POST(
      postRequest({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0001"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("rejects invalid public input before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await route.POST(
      postRequest({
        firstName: "Jane",
        lastName: "Smith",
        email: "not-an-email",
        experience: "vip-only",
        eventDate: "07/10/2026",
        guestCount: "900",
        idempotencyKey: "short"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("valid email");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("forwards a normalized durable inquiry request", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      inquiryId: "inquiry_123",
      emailLower: "jane@example.com",
      experience: "champagne-room",
      eventDate: "2026-07-10",
      guestCount: "9-12",
      status: "pending",
      createdAt: 1782960000000,
      replayed: false
    });

    const response = await route.POST(
      postRequest({
        firstName: " Jane ",
        lastName: " Smith ",
        email: " Jane@Example.com ",
        experience: "champagne-room",
        eventDate: "2026-07-10",
        guestCount: "9-12",
        notes: "  Window timing, please  ",
        source: " native-experiences ",
        status: "approved",
        createdAt: 1,
        idempotencyKey: "inquiry_apply_0002"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.inquiry).toMatchObject({ inquiryId: "inquiry_123", status: "pending" });
    expect(fetchMutation).toHaveBeenCalledWith(
      "inquiries:submitInquiry",
      {
        firstName: "Jane",
        lastName: "Smith",
        email: "Jane@Example.com",
        experience: "champagne-room",
        eventDate: "2026-07-10",
        guestCount: "9-12",
        notes: "Window timing, please",
        source: "native-experiences",
        idempotencyKey: "inquiry_apply_0002"
      },
      { url: "https://example.convex.cloud" }
    );
  });

  it("returns conflict when the idempotency key is reused for a different inquiry", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("idempotencyKey was already used for a different inquiry"));

    const response = await route.POST(
      postRequest({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0003"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("different inquiry");
  });
});
