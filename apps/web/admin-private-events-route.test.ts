import { fetchMutation, fetchQuery } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as cancelPrivateEvent } from "./app/api/admin/private-events/cancel/route";
import { GET, POST } from "./app/api/admin/private-events/route";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn()
}));

const fetchQueryMock = vi.mocked(fetchQuery);
const fetchMutationMock = vi.mocked(fetchMutation);
const staffHeaders = { authorization: "Bearer staff.jwt.token" };

function request(path: string, body?: unknown, headers: Record<string, string> = staffHeaders) {
  return new Request(`https://skydeckla.com/api/admin/private-events${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const createBody = {
  visitDate: "2026-10-10",
  label: " Corporate buyout ",
  notes: "",
  idempotencyKey: "private_event_route_01"
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  fetchQueryMock.mockReset();
  fetchMutationMock.mockReset();
});

describe("/api/admin/private-events", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    for (const response of [
      await GET(request("", undefined, {})),
      await POST(request("", createBody, {})),
      await cancelPrivateEvent(request("/cancel", { eventRef: "PEV20261010-ABC123", reason: "x" }, {}))
    ]) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "staff_auth_required" });
    }
    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured", async () => {
    const response = await POST(request("", createBody));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "convex_unconfigured" });
  });

  it("reads the staff calendar with the bearer token and validated range", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({ fromDate: "2026-10-02", events: [] });

    const response = await GET(request("?from=2026-10-02&limit=20"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      { fromDate: "2026-10-02", limit: 20 },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it.each([
    ["an impossible from date", "?from=2026-02-30", "from must be a real YYYY-MM-DD date"],
    ["an oversized limit", "?limit=500", "limit must be a whole number from 1 to 100"]
  ])("rejects %s before reading Convex", async (_label, query, error) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("creates an event with trimmed, bounded fields only", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({
      event: { eventRef: "PEV20261010-ABC123", visitDate: "2026-10-10", status: "confirmed", label: "Corporate buyout", createdAt: 1 },
      reused: false
    });

    const response = await POST(request("", { ...createBody, status: "cancelled", partySize: 0 }));

    expect(response.status).toBe(201);
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      { visitDate: "2026-10-10", label: "Corporate buyout", idempotencyKey: "private_event_route_01" },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it.each([
    ["a missing date", { ...createBody, visitDate: undefined }, "visitDate must be a real YYYY-MM-DD date"],
    ["a missing label", { ...createBody, label: " " }, "label is required"],
    ["a malformed key", { ...createBody, idempotencyKey: "short" }, "idempotencyKey must be 12-96 URL-safe characters"]
  ])("rejects %s before calling Convex", async (_label, body, error) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await POST(request("", body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Private event conflicts with 4 held or committed visitor places on that date", 409],
    ["idempotencyKey was already used for a different private event", 409],
    ["Staff role must be one of: admin", 403]
  ])("maps %s to HTTP %i", async (message, status) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(new Error(message));

    const response = await POST(request("", createBody));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: message });
  });

  it("cancels by reference with a required reason", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({ event: { status: "cancelled" }, reused: false });

    const bad = await cancelPrivateEvent(request("/cancel", { eventRef: "PEV20261010-ABC123", reason: "" }));
    expect(bad.status).toBe(400);
    const forged = await cancelPrivateEvent(request("/cancel", { eventRef: "ORD-1", reason: "x" }));
    expect(forged.status).toBe(400);
    expect(fetchMutationMock).not.toHaveBeenCalled();

    const response = await cancelPrivateEvent(
      request("/cancel", { eventRef: "PEV20261010-ABC123", reason: " Client postponed " })
    );
    expect(response.status).toBe(200);
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      { eventRef: "PEV20261010-ABC123", reason: "Client postponed" },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });
});
