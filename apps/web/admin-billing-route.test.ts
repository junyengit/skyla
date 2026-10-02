import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { billingDetailFixture, billingPageFixture } from "./billing-contract-test-support";

vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }));
vi.mock("convex/server", () => ({ makeFunctionReference: vi.fn((name: string) => name) }));
const { fetchQuery } = await import("convex/nextjs");
const queue = await import("./app/api/admin/exceptions/route");
const detail = await import("./app/api/admin/billing/detail/route");
const request = (path: string, auth = true) => new Request(`https://skydeckla.test/api/admin/${path}`, { headers: auth ? { authorization: "Bearer staff_token" } : {} });

beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud"); });
afterEach(() => { vi.mocked(fetchQuery).mockReset(); vi.unstubAllEnvs(); });

describe("strict Billing read routes", () => {
  it("uses the new bounded page query only for explicitpage1 while retaining legacy output", async () => {
    vi.mocked(fetchQuery).mockResolvedValueOnce(billingPageFixture());
    const response = await queue.GET(request("exceptions?page=1"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("vary")).toContain("Authorization");
    expect(fetchQuery).toHaveBeenLastCalledWith("operationsExceptions:listOperationsExceptionsPage", { status: "open", limit: 25, cursor: null, endCursor: null }, { token: "staff_token", url: "https://example.convex.cloud" });
    const legacy = { status: "open", capped: false, exceptions: [{ code: "legacy-unchanged" }] };
    vi.mocked(fetchQuery).mockResolvedValueOnce(legacy);
    const old = await queue.GET(request("exceptions?status=open&limit=10"));
    expect(await old.json()).toEqual(legacy);
    expect(fetchQuery).toHaveBeenLastCalledWith("operationsExceptions:listOperationsExceptions", { status: "open", limit: 10 }, { token: "staff_token", url: "https://example.convex.cloud" });
  });
  it.each(["exceptions?page=", "exceptions?page=2", "exceptions?page=1&page=1", "exceptions?page=1&secret=CANARY", "exceptions?page=1&cursor=", "billing/detail?exceptionId=one&exceptionId=two", "billing/detail?exceptionId=one&orderRef=other"])("rejects %s before dispatch", async path => {
    const response = path.startsWith("exceptions") ? await queue.GET(request(path)) : await detail.GET(request(path));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "billing_request_rejected" }); expect(fetchQuery).not.toHaveBeenCalled();
  });
  it("requires authentication before any valid read and uses exact selected identity", async () => {
    expect((await detail.GET(request("billing/detail?exceptionId=exception-one", false))).status).toBe(401);
    expect(fetchQuery).not.toHaveBeenCalled();
    vi.mocked(fetchQuery).mockResolvedValueOnce(billingDetailFixture());
    const response = await detail.GET(request("billing/detail?exceptionId=exception-one"));
    expect(response.status).toBe(200);
    expect(fetchQuery).toHaveBeenLastCalledWith("billingDetails:getOperationsExceptionDetail", { exceptionId: "exception-one" }, { token: "staff_token", url: "https://example.convex.cloud" });
  });
  it.each([new SyntaxError("Unexpected end of JSON input CANARY"), new Error("Staff role must be admin; CANARY"), new Error("not found CANARY"), Object.assign(new Error("CANARY"), { data: { kind: "billing_read_error", version: 1, code: "billing_access_denied" } })])("does not classify arbitrary exception text/data as a typed failure %#", async failure => {
    vi.mocked(fetchQuery).mockRejectedValueOnce(failure);
    const response = await detail.GET(request("billing/detail?exceptionId=exception-one"));
    expect(response.status).toBe(502); const body = await response.json(); expect(body.code).toBe("billing_read_unverified"); expect(JSON.stringify(body)).not.toContain("CANARY");
  });
  it.each([
    ["billing_access_denied", 403], ["billing_cursor_invalid", 400], ["billing_read_unverified", 502]
  ] as const)("classifies exact actual ConvexError receipt %s", async (code, status) => {
    vi.mocked(fetchQuery).mockRejectedValueOnce(new ConvexError({ kind: "billing_read_error", version: 1, code }));
    const response = await queue.GET(request("exceptions?page=1"));
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code });
  });
  it("accepts404 only with the exact submitted ID; foreign or malformed typed receipts stay502", async () => {
    for (const lookup of [{ exceptionId: "exception-one" }, { exceptionId: "foreign" }, { exceptionId: "exception-one", providerId: "CANARY" }]) {
      vi.mocked(fetchQuery).mockRejectedValueOnce(new ConvexError({ kind: "billing_read_error", version: 1, code: "billing_record_not_found", lookup }));
      const response = await detail.GET(request("billing/detail?exceptionId=exception-one"));
      expect(response.status).toBe(Object.keys(lookup).length === 1 && lookup.exceptionId === "exception-one" ? 404 : 502);
      expect(JSON.stringify(await response.json())).not.toContain("CANARY");
    }
  });
  it("rejects privacy leakage and foreign identities in successful query replies", async () => {
    const row = billingDetailFixture("foreign"); Object.assign(row.evidence, { customerEmail: "CANARY@example.com" });
    vi.mocked(fetchQuery).mockResolvedValueOnce(row);
    const response = await detail.GET(request("billing/detail?exceptionId=exception-one"));
    expect(response.status).toBe(502); expect(JSON.stringify(await response.json())).not.toContain("CANARY");
    vi.mocked(fetchQuery).mockResolvedValueOnce({ ...billingPageFixture(), isDone: false });
    expect((await queue.GET(request("exceptions?page=1"))).status).toBe(502);
  });
});
