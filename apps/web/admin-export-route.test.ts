import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn()
}));

vi.mock("convex/server", () => ({
  makeFunctionReference: vi.fn((name: string) => name)
}));

const { fetchQuery } = await import("convex/nextjs");
const route = await import("./app/api/admin/export/route");

const fetchQueryMock = vi.mocked(fetchQuery);

function request(headers?: HeadersInit, url = "https://skydeckla.test/api/admin/export?kind=bookings") {
  return new Request(url, { headers });
}

describe("admin export route", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const originalServerConvexUrl = process.env.CONVEX_URL;

  afterEach(() => {
    fetchQueryMock.mockReset();
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
    process.env.CONVEX_URL = originalServerConvexUrl;
  });

  it("requires staff bearer auth before checking configuration", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(data).toMatchObject({ code: "staff_auth_required" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;

    const response = await route.GET(request({ authorization: "Bearer staff.jwt.token" }));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data).toMatchObject({ code: "convex_unconfigured" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("rejects invalid export parameters before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const invalidKind = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=raw")
    );
    const invalidLimit = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=bookings&limit=251")
    );
    const invalidFormat = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=bookings&format=json")
    );

    expect(invalidKind.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(invalidFormat.status).toBe(400);
    await expect(invalidKind.json()).resolves.toMatchObject({ error: expect.stringContaining("kind must") });
    await expect(invalidLimit.json()).resolves.toMatchObject({ error: expect.stringContaining("limit must") });
    await expect(invalidFormat.json()).resolves.toMatchObject({ error: "format must be csv" });
    expect(fetchQueryMock).not.toHaveBeenCalled();
  });

  it("forwards token and bounded export arguments to Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "admin" },
      kind: "orders",
      generatedAt: Date.UTC(2026, 6, 5),
      limit: 25,
      rows: [
        {
          orderRef: "SKY2607-ABC123",
          channel: "online",
          status: "paid",
          totalCents: 5800,
          currency: "usd",
          expectedProvider: "stripe",
          customerEmailLower: "guest@example.com",
          visitDate: "2026-07-10",
          entryTime: "19:00",
          createdAt: Date.UTC(2026, 6, 4, 18),
          updatedAt: Date.UTC(2026, 6, 4, 18, 5),
          raw: { ignored: true }
        }
      ]
    });

    const response = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=orders&limit=25")
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="skyla-orders-2026-07-05.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(csv.split("\n")[0]).toBe(
      "order_ref,channel,status,total_cents,currency,expected_provider,customer_email,visit_date,entry_time,created_at,updated_at"
    );
    expect(csv).toContain("SKY2607-ABC123,online,paid,5800,usd,stripe,guest@example.com,2026-07-10,19:00");
    expect(csv).not.toContain("ignored");
    expect(fetchQueryMock).toHaveBeenCalledWith(
      "admin:getAdminExportRows",
      { kind: "orders", limit: 25 },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("neutralizes formula-like cells and omits raw sensitive payload fields", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "admin" },
      kind: "inquiries",
      generatedAt: Date.UTC(2026, 6, 5),
      limit: 250,
      rows: [
        {
          inquiryId: "inq_123",
          status: "new",
          email: "=HYPERLINK(\"https://bad.example\")",
          emailLower: "guest@example.com",
          firstName: "+cmd",
          lastName: "Guest",
          experience: "Private party",
          eventDate: "2026-08-01",
          guestCount: "12",
          notes: "@malicious",
          source: "web",
          createdAt: Date.UTC(2026, 6, 4),
          updatedAt: Date.UTC(2026, 6, 4, 1),
          raw: { client_secret: "should_not_export" },
          idempotencyKey: "idem_secret"
        }
      ]
    });

    const response = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=inquiries")
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'@malicious");
    expect(csv).not.toContain("client_secret");
    expect(csv).not.toContain("should_not_export");
    expect(csv).not.toContain("idem_secret");
  });

  it("masks payment and terminal identifiers in bulk exports", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockResolvedValueOnce({
      staff: { emailLower: "ops@example.com", role: "admin" },
      kind: "payments",
      generatedAt: Date.UTC(2026, 6, 5),
      limit: 250,
      rows: [
        {
          provider: "terminal",
          providerPaymentId: "pi_test_1234567890",
          status: "paid",
          amountCents: 9700,
          currency: "usd",
          saleRef: "POS2607-ABC123",
          rawEventId: "evt_test_abcdef123456",
          createdAt: Date.UTC(2026, 6, 4)
        }
      ]
    });

    const response = await route.GET(
      request({ authorization: "Bearer staff.jwt.token" }, "https://skydeckla.test/api/admin/export?kind=payments")
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv.split("\n")[0]).toContain("provider_payment_id_masked");
    expect(csv).toContain("pi_t...7890");
    expect(csv).toContain("evt_...3456");
    expect(csv).not.toContain("pi_test_1234567890");
    expect(csv).not.toContain("evt_test_abcdef123456");
  });

  it("maps Convex staff role failures to forbidden", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    fetchQueryMock.mockRejectedValueOnce(new Error("Staff role must be one of: admin"));

    const response = await route.GET(request({ authorization: "Bearer viewer.jwt.token" }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "Staff role must be one of: admin"
    });
  });
});
