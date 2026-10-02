import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("convex/nextjs", () => ({ fetchMutation: vi.fn(), fetchQuery: vi.fn() }));
vi.mock("convex/server", () => ({ makeFunctionReference: vi.fn((name: string) => name) }));
const { fetchMutation, fetchQuery } = await import("convex/nextjs");
const { POST } = await import("./app/api/admin/admission/departure/route");
const { GET } = await import("./app/api/admin/admission/occupancy/route");
const request = (body: unknown, token?: string) => new Request("https://skydeckla.com/api/admin/admission/departure", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud"));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("staff admission API boundaries", () => {
  it("rejects unauthenticated occupancy and departure before backend calls", async () => {
    expect((await GET(new Request("https://skydeckla.com/api/admin/admission/occupancy"))).status).toBe(401);
    expect((await POST(request({ bookingRef: "TEST", departedCount: 1 }))).status).toBe(401);
    expect(fetchMutation).not.toHaveBeenCalled(); expect(fetchQuery).not.toHaveBeenCalled();
  });
  it.each([-1, 0, 1.5, 31, "1"])("rejects invalid departedCount %s", async departedCount => {
    expect((await POST(request({ bookingRef: "TEST", departedCount }, "staff"))).status).toBe(400);
    expect(fetchMutation).not.toHaveBeenCalled();
  });
  it("forwards only the authorized proof and absolute count, never browser occupancy", async () => {
    vi.mocked(fetchMutation).mockResolvedValue({ outcome: "recorded", remainingInside: 2 });
    const response = await POST(request({ bookingRef: "TEST", departedCount: 2, insideCount: 0, partySize: 30 }, "staff"));
    expect(fetchMutation).toHaveBeenCalledWith("admissions:recordDeparture", { bookingRef: "TEST", departedCount: 2 }, { token: "staff", url: "https://test.convex.cloud" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("makes server admission conflicts visible without claiming success", async () => {
    vi.mocked(fetchMutation).mockRejectedValue(new Error("Admission blocked: legacy occupancy needs reconciliation"));
    const response = await POST(request({ bookingRef: "TEST", departedCount: 2 }, "staff"));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: expect.stringContaining("reconciliation") });
  });
});
