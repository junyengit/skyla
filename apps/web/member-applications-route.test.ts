import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchMutation } = await import("convex/nextjs");
const route = await import("./app/api/members/applications/route");

function postRequest(body: Record<string, unknown>) {
  return new Request("https://skydeckla.com/api/members/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("/api/members/applications", () => {
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
        firstName: "Ari",
        lastName: "Stone",
        email: "ari@example.com",
        tier: "gold",
        idempotencyKey: "member_apply_0001"
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
        firstName: "Ari",
        lastName: "Stone",
        email: "not-an-email",
        tier: "owner",
        idempotencyKey: "short"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("valid email");
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("forwards a normalized durable application request", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      memberId: "member_123",
      emailLower: "ari@example.com",
      tier: "gold",
      status: "pending",
      createdAt: 1782960000000,
      replayed: false
    });

    const response = await route.POST(
      postRequest({
        firstName: " Ari ",
        lastName: " Stone ",
        email: " Ari@Example.com ",
        phone: "   ",
        tier: "gold",
        source: " Referred by a current member ",
        bio: " Loves skyline evenings ",
        status: "approved",
        createdAt: 1,
        idempotencyKey: "member_apply_0002"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.member).toMatchObject({ memberId: "member_123", status: "pending" });
    expect(fetchMutation).toHaveBeenCalledWith(
      "memberApplications:submitApplication",
      {
        firstName: "Ari",
        lastName: "Stone",
        email: "Ari@Example.com",
        tier: "gold",
        source: "Referred by a current member",
        bio: "Loves skyline evenings",
        idempotencyKey: "member_apply_0002"
      },
      { url: "https://example.convex.cloud" }
    );
  });

  it("returns conflict when the idempotency key is reused for a different application", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("idempotencyKey was already used for a different member application"));

    const response = await route.POST(
      postRequest({
        firstName: "Ari",
        lastName: "Stone",
        email: "ari@example.com",
        tier: "obsidian",
        idempotencyKey: "member_apply_0003"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("different member application");
  });
});
