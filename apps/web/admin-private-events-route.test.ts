import { fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as cancelPrivateEvent } from "./app/api/admin/private-events/cancel/route";
import { GET as getOperation } from "./app/api/admin/private-events/operation/route";
import { GET, POST } from "./app/api/admin/private-events/route";
import { calendarMutationFingerprint, normalizeCalendarCreateRequest } from "./lib/calendar-contract";

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
  confirmationSource: "owner-confirmation",
  sourceRef: " Mike confirmed October 1 ",
  idempotencyKey: "private_event_route_01"
};
function createRejection(message = "Private event conflicts with an existing confirmed private event on that date") {
  return {
    kind: "private_event_rejected" as const, version: 1 as const, operation: "create" as const,
    lookup: { key: createBody.idempotencyKey },
    requestFingerprint: calendarMutationFingerprint({ kind: "create", request: normalizeCalendarCreateRequest(createBody) }), message
  };
}

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
      await cancelPrivateEvent(request("/cancel", { eventRef: "PEV20261010-ABC123", reason: "x" }, {})),
      await getOperation(request("/operation?key=private_event_route_01", undefined, {}))
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
      role: "admin",
      event: { eventRef: "PEV20261010-ABC123", visitDate: "2026-10-10", status: "confirmed", label: "Corporate buyout", createdAt: 1, confirmationSource: "owner-confirmation", sourceRef: "Mike confirmed October 1" },
      reused: false
    });

    const response = await POST(request("", createBody));

    expect(response.status).toBe(201);
    expect(fetchMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      { visitDate: "2026-10-10", label: "Corporate buyout", confirmationSource: "owner-confirmation", sourceRef: "Mike confirmed October 1", idempotencyKey: "private_event_route_01" },
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
    ["Staff role must be one of: admin", 409]
  ])("attests atomic rejection %s at HTTP %i", async (message, status) => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(new ConvexError(createRejection(message)));

    const response = await POST(request("", createBody));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: message, code: "calendar_mutation_rejected", rejection: createRejection(message) });
  });

  it("cancels by reference with a required reason", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce({ role: "admin", event: {
      eventRef: "PEV20261010-ABC123", visitDate: "2026-10-10", status: "cancelled", label: "Corporate buyout",
      createdAt: 1, cancelledAt: 2, cancelReason: "Client postponed"
    }, reused: false });

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

const confirmed = {
  eventRef: "PEV20261010-ABC123", visitDate: "2026-10-10", status: "confirmed",
  label: "Corporate buyout", createdAt: 1,
  confirmationSource: "owner-confirmation", sourceRef: "Mike confirmed October 1"
};
const range = { from: "2026-10-01", to: "2026-10-30" };
const page = {
  role: "viewer", range, cutoff: 100, events: [confirmed],
  continueCursor: null, isDone: true, pageStatus: null, splitCursor: null,
  endCursor: null, segmentDone: true
};

describe("bounded calendar routes and recovery", () => {
  it("passes bounded range cursors without replacing server completeness", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const split = { ...page, isDone: false, segmentDone: false, pageStatus: "SplitRequired", splitCursor: "middle", continueCursor: "parent-end" };
    fetchQueryMock.mockResolvedValueOnce(split);
    const response = await GET(request("?from=2026-10-01&to=2026-10-30&cursor=start"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(split);
    expect(fetchQueryMock).toHaveBeenCalledWith(expect.anything(), { ...range, cursor: "start" }, { url: "https://example.convex.cloud", token: "staff.jwt.token" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toContain("Authorization");
  });

  it("keeps bounded segment completion distinct from the whole range", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const result = { ...page, isDone: false, endCursor: "middle" };
    fetchQueryMock.mockResolvedValueOnce(result);
    const response = await GET(request("?from=2026-10-01&to=2026-10-30&endCursor=middle"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(result);
    expect(fetchQueryMock).toHaveBeenCalledWith(expect.anything(), { ...range, endCursor: "middle" }, expect.anything());
  });

  it.each([
    "?to=2026-10-30", "?from=2026-02-30&to=2026-03-01",
    "?from=2026-10-02&to=2026-10-01", "?from=2026-01-01&to=2027-01-02",
    "?from=2026-10-01&to=2026-10-30&limit=100",
    "?from=2026-10-01&from=2026-10-02&to=2026-10-30",
    "?from=2026-10-01&to=2026-10-30&cursor=", "?cursor=missing-range"
  ])("rejects invalid or ambiguous query %s before backend work", async query => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    expect((await GET(request(query))).status).toBe(400);
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...page, role: "pos" }, { ...page, range: { ...range, to: "2026-10-31" } },
    { ...page, events: [{ ...confirmed, eventRef: "PEV20261011-ABC123" }] },
    { ...page, events: [{ ...confirmed, createdAt: 101 }] },
    { ...page, endCursor: "foreign" },
    { ...page, isDone: false, segmentDone: false, continueCursor: "start" },
    { ...page, pageStatus: "SplitRequired", splitCursor: "middle", continueCursor: "end" }
  ])("refuses malformed range success %j", async reply => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce(reply);
    const response = await GET(request("?from=2026-10-01&to=2026-10-30&cursor=start"));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_response_unverified" });
  });

  it("rejects unsupported create fields and partial source instead of silently changing identity", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    for (const body of [
      { ...createBody, status: "cancelled", partySize: 0 },
      { ...createBody, sourceRef: "" }, { ...createBody, confirmationSource: "inquiry" }
    ]) expect((await POST(request("", body))).status).toBe(400);
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });

  it("allows an exact legacy replay after its date without inventing provenance", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const body = { visitDate: "2020-02-29", label: "Legacy buyout", idempotencyKey: "legacy_calendar_key" };
    const event = { eventRef: "PEV20200229-ABC123", visitDate: body.visitDate, status: "confirmed", label: body.label, createdAt: 1 };
    fetchMutationMock.mockResolvedValueOnce({ role: "admin", event, reused: true });
    const response = await POST(request("", body));
    expect(response.status).toBe(200);
    expect(fetchMutationMock).toHaveBeenCalledWith(expect.anything(), body, expect.anything());
    await expect(response.json()).resolves.toEqual({ role: "admin", event, reused: true });
  });

  it.each([
    { role: "viewer", event: confirmed, reused: false },
    { role: "admin", event: { ...confirmed, label: "Different buyout" }, reused: false },
    { role: "admin", event: { ...confirmed, sourceRef: "Different evidence" }, reused: true },
    { role: "admin", event: confirmed, reused: "false" },
    { role: "admin", event: { ...confirmed, confirmationSource: undefined, sourceRef: undefined }, reused: false }
  ])("never announces success for a malformed create reply %j", async reply => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce(reply);
    const response = await POST(request("", createBody));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
  });

  it("recovers a lost committed create by the same frozen key and body", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    let stored: typeof confirmed | undefined;
    fetchMutationMock.mockImplementationOnce(async (...callArgs) => {
      const args = callArgs[1];
      expect(args).toEqual({ visitDate: "2026-10-10", label: "Corporate buyout", confirmationSource: "owner-confirmation", sourceRef: "Mike confirmed October 1", idempotencyKey: createBody.idempotencyKey });
      stored = confirmed;
      throw new TypeError("connection reset after commit");
    });
    expect((await POST(request("", createBody))).status).toBe(502);
    fetchQueryMock.mockResolvedValueOnce({ role: "admin", lookup: { key: createBody.idempotencyKey }, event: stored });
    const recovered = await getOperation(request(`/operation?key=${createBody.idempotencyKey}`));
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({ event: confirmed });
    expect(fetchQueryMock).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: createBody.idempotencyKey }, expect.anything());
    fetchMutationMock.mockResolvedValueOnce({ role: "admin", event: stored, reused: true });
    expect((await POST(request("", createBody))).status).toBe(200);
    expect(fetchMutationMock.mock.calls.map(call => (call[1] as { idempotencyKey: string }).idempotencyKey)).toEqual([createBody.idempotencyKey, createBody.idempotencyKey]);
  });

  it.each(["", "?key=a", "?event=ORD-1", "?key=private_event_route_01&event=PEV20261010-ABC123", "?key=private_event_route_01&key=private_event_route_02"])("rejects ambiguous operation lookup %s", async query => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    expect((await getOperation(request(`/operation${query}`))).status).toBe(400);
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("returns authoritative null without treating absence as failed mutation", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const reply = { role: "viewer", lookup: { key: createBody.idempotencyKey }, event: null };
    fetchQueryMock.mockResolvedValueOnce(reply);
    const response = await getOperation(request(`/operation?key=${createBody.idempotencyKey}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(reply);
  });

  it("rejects recovery of a different event even when the lookup echo matches", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      role: "admin", lookup: { eventRef: confirmed.eventRef }, event: { ...confirmed, eventRef: "PEV20261010-XYZ789" }
    });
    const response = await getOperation(request(`/operation?event=${confirmed.eventRef}`));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_response_unverified" });
  });

  it.each([
    { role: "admin", lookup: { key: "different_calendar_key" }, event: confirmed },
    { role: "pos", lookup: { key: createBody.idempotencyKey }, event: confirmed },
    { role: "admin", event: confirmed }
  ])("rejects an unbound recovery reply %j", async reply => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce(reply);
    const response = await getOperation(request(`/operation?key=${createBody.idempotencyKey}`));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_response_unverified" });
  });

  it("preserves a first cancellation reason during lost-reply recovery and repeat", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const event = { ...confirmed, status: "cancelled", cancelledAt: 2, cancelReason: "First reason" };
    fetchMutationMock.mockRejectedValueOnce(new TypeError("connection reset after cancel"));
    expect((await cancelPrivateEvent(request("/cancel", { eventRef: confirmed.eventRef, reason: "First reason" }))).status).toBe(502);
    fetchQueryMock.mockResolvedValueOnce({ role: "admin", lookup: { eventRef: confirmed.eventRef }, event });
    const recovered = await getOperation(request(`/operation?event=${confirmed.eventRef}`));
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({ event });
    fetchMutationMock.mockResolvedValueOnce({ role: "admin", event, reused: true });
    const repeated = await cancelPrivateEvent(request("/cancel", { eventRef: confirmed.eventRef, reason: "Different later reason" }));
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({ event: { cancelReason: "First reason", sourceRef: confirmed.sourceRef }, reused: true });
  });

  it.each([
    { role: "admin", event: confirmed, reused: false },
    { role: "admin", event: { ...confirmed, status: "cancelled", cancelledAt: 2 }, reused: false },
    { role: "admin", event: { ...confirmed, eventRef: "PEV20261010-XYZ789", status: "cancelled", cancelledAt: 2, cancelReason: "Reason" }, reused: false },
    { role: "admin", event: { ...confirmed, status: "cancelled", cancelledAt: 2, cancelReason: "Different" }, reused: false }
  ])("refuses malformed cancellation success %j", async reply => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockResolvedValueOnce(reply);
    const response = await cancelPrivateEvent(request("/cancel", { eventRef: confirmed.eventRef, reason: "Reason" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
  });
});


describe("calendar mutation rejection attestation", () => {
  it.each([
    new SyntaxError("Unexpected end of JSON input"),
    new Error("Staff role must be one of: admin"),
    new Error("Private event conflicts with an existing confirmed private event on that date"),
    new Error("Private event was not found")
  ])("keeps a post-dispatch exception unknown regardless of its message: %s", async failure => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    for (const [endpoint, body] of [
      ["create", createBody], ["cancel", { eventRef: confirmed.eventRef, reason: "Original reason" }]
    ] as const) {
      fetchMutationMock.mockRejectedValueOnce(failure);
      const response = endpoint === "create" ? await POST(request("", body)) : await cancelPrivateEvent(request("/cancel", body));
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
    }
  });

  it("preserves uncertainty when the committed create response cannot be decoded", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    let stored: typeof confirmed | null = null;
    fetchMutationMock.mockImplementationOnce(async () => {
      stored = confirmed;
      throw new SyntaxError("Unexpected end of JSON input");
    });
    const response = await POST(request("", createBody));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
    expect(stored).toEqual(confirmed);
    fetchQueryMock.mockResolvedValueOnce({ role: "admin", lookup: { key: createBody.idempotencyKey }, event: stored });
    const recovered = await getOperation(request(`/operation?key=${createBody.idempotencyKey}`));
    expect(recovered.status).toBe(200);
    await expect(recovered.json()).resolves.toMatchObject({ event: confirmed });
  });

  it.each([
    { ...createRejection(), version: 2 }, { ...createRejection(), operation: "cancel" },
    { ...createRejection(), lookup: { key: "foreign_calendar_key" } },
    { ...createRejection(), requestFingerprint: "v1:foreign" },
    { ...createRejection(), message: "x".repeat(501) },
    { ...createRejection(), debug: "unsupported" },
    "private event rejected"
  ])("refuses malformed or foreign actual ConvexError receipt %j", async receipt => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(new ConvexError(receipt));
    const response = await POST(request("", createBody));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
  });

  it("does not attest an Error merely because it carries a data-shaped receipt", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchMutationMock.mockRejectedValueOnce(Object.assign(new Error("ConvexError"), { data: createRejection() }));
    const response = await POST(request("", createBody));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
  });

  it("attests the exact frozen cancellation body, including the first submitted reason", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const body = { eventRef: confirmed.eventRef, reason: "Original reason" };
    const rejection = { kind: "private_event_rejected" as const, version: 1, operation: "cancel" as const,
      lookup: { eventRef: body.eventRef }, requestFingerprint: calendarMutationFingerprint({ kind: "cancel", request: body }), message: "Private event was not found" };
    fetchMutationMock.mockRejectedValueOnce(new ConvexError(rejection));
    const response = await cancelPrivateEvent(request("/cancel", body));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: rejection.message, code: "calendar_mutation_rejected", rejection });
    fetchMutationMock.mockRejectedValueOnce(new ConvexError(rejection));
    const changed = await cancelPrivateEvent(request("/cancel", { ...body, reason: "Changed reason" }));
    expect(changed.status).toBe(502);
    await expect(changed.json()).resolves.toMatchObject({ code: "calendar_mutation_unknown" });
  });

  it("rejects invalid JSON explicitly before dispatch", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const response = await POST(new Request("https://skydeckla.com/api/admin/private-events", { method: "POST", headers: staffHeaders, body: "{" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "calendar_request_rejected" });
    expect(fetchMutationMock).not.toHaveBeenCalled();
  });
});
