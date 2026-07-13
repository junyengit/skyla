import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchMutation, fetchQuery } = await import("convex/nextjs");
const listRoute = await import("./app/api/admin/inquiries/route");
const detailRoute = await import("./app/api/admin/inquiries/detail/route");
const updateRoute = await import("./app/api/admin/inquiries/update/route");

function getRequest(path: string, headers?: HeadersInit) {
  return new Request(`https://skydeckla.test${path}`, { headers });
}

function postRequest(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("https://skydeckla.test/api/admin/inquiries/update", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("admin inquiry routes", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff auth before list configuration checks", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await listRoute.GET(getRequest("/api/admin/inquiries"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "staff_auth_required" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("fails closed when list Convex configuration is missing", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await listRoute.GET(
      getRequest("/api/admin/inquiries", { Authorization: "Bearer staff_token" })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("validates list filters before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const invalidStatus = await listRoute.GET(
      getRequest("/api/admin/inquiries?status=deleted", { Authorization: "Bearer staff_token" })
    );
    const invalidLimit = await listRoute.GET(
      getRequest("/api/admin/inquiries?limit=51", { Authorization: "Bearer staff_token" })
    );

    expect(invalidStatus.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("forwards bounded list filters and returns only the Convex-masked summary", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "viewer" },
      inquiries: [
        {
          inquiryId: "inquiries_1",
          status: "pending",
          contactMasked: "j***@e***.com",
          experience: "champagne-room",
          createdAt: 100
        }
      ]
    });

    const response = await listRoute.GET(
      getRequest("/api/admin/inquiries?limit=20&status=pending", { Authorization: "Bearer staff_token" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(data.inquiries[0]).toEqual(
      expect.objectContaining({ inquiryId: "inquiries_1", contactMasked: "j***@e***.com" })
    );
    expect(fetchQuery).toHaveBeenCalledWith(
      "admin:listExperienceInquiries",
      { limit: 20, status: "pending" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("reveals inquiry PII through the separately authorized detail route", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchQuery).mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "viewer" },
      inquiry: {
        inquiryId: "inquiries_1",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        status: "pending",
        notes: "Window table",
        createdAt: 100
      }
    });

    const response = await detailRoute.GET(
      getRequest("/api/admin/inquiries/detail?inquiryId=inquiries_1", {
        Authorization: "Bearer staff_token"
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.inquiry).toMatchObject({ email: "jane@example.com", notes: "Window table" });
    expect(fetchQuery).toHaveBeenCalledWith(
      "admin:getExperienceInquiryDetail",
      { inquiryId: "inquiries_1" },
      { url: "https://example.convex.cloud", token: "staff_token" }
    );
  });

  it("rejects missing detail IDs and invalid updates before Convex calls", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    const headers = { Authorization: "Bearer staff_token" };

    const missingId = await detailRoute.GET(getRequest("/api/admin/inquiries/detail", headers));
    const invalidStatus = await updateRoute.POST(
      postRequest({ inquiryId: "inquiries_1", status: "deleted" }, headers)
    );
    const emptyUpdate = await updateRoute.POST(postRequest({ inquiryId: "inquiries_1" }, headers));
    const oversizedNotes = await updateRoute.POST(
      postRequest({ inquiryId: "inquiries_1", notes: "x".repeat(2001) }, headers)
    );

    expect(missingId.status).toBe(400);
    expect(invalidStatus.status).toBe(400);
    expect(emptyUpdate.status).toBe(400);
    expect(oversizedNotes.status).toBe(400);
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("requires staff auth before update configuration checks", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await updateRoute.POST(
      postRequest({ inquiryId: "inquiries_1", status: "contacted" })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "staff_auth_required" });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("forwards validated status and notes updates with the staff token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockResolvedValueOnce({
      inquiryId: "inquiries_1",
      status: "contacted",
      notes: "Call after 4pm",
      createdAt: 100,
      updatedAt: 200
    });

    const response = await updateRoute.POST(
      postRequest(
        { inquiryId: " inquiries_1 ", status: "contacted", notes: " Call after 4pm " },
        { Authorization: "Bearer admin_token" }
      )
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.inquiry).toMatchObject({ status: "contacted", notes: "Call after 4pm" });
    expect(fetchMutation).toHaveBeenCalledWith(
      "admin:updateExperienceInquiry",
      { inquiryId: "inquiries_1", status: "contacted", notes: "Call after 4pm" },
      { url: "https://example.convex.cloud", token: "admin_token" }
    );
  });

  it("maps Convex admin-role failures to forbidden", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    vi.mocked(fetchMutation).mockRejectedValueOnce(new Error("Staff role must be one of: admin"));

    const response = await updateRoute.POST(
      postRequest(
        { inquiryId: "inquiries_1", status: "closed" },
        { Authorization: "Bearer viewer_token" }
      )
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
