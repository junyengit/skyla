import { fetchAction } from "convex/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as CREATE_POST } from "./app/api/payments/stripe-terminal/route";
import { POST as PROCESS_POST } from "./app/api/payments/stripe-terminal/process/route";

vi.mock("convex/nextjs", () => ({
  fetchAction: vi.fn()
}));

const fetchActionMock = vi.mocked(fetchAction);

function expectStaffPaymentHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
}

function request(body: unknown, init?: RequestInit, path = "/api/payments/stripe-terminal") {
  return new Request(`https://skydeckla.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  });
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.CONVEX_URL;
  delete process.env.SKYLA_POS_TERMINAL_ACCEPTANCE;
  fetchActionMock.mockReset();
});

describe("/api/payments/stripe-terminal", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    const response = await CREATE_POST(
      request({
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      })
    );

    expect(response.status).toBe(401);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    const response = await CREATE_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("requires saleRef and idempotencyKey before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";

    const response = await CREATE_POST(
      request({ saleRef: "SALE260704-ABC123" }, { headers: { authorization: "Bearer staff.jwt.token" } })
    );

    expect(response.status).toBe(400);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      error: "idempotencyKey is required",
      code: "invalid_payment_request"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("surfaces server configuration failures as unavailable", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockRejectedValueOnce(new Error("STRIPE_SECRET_KEY does not match SKYLA_STRIPE_MODE"));

    const response = await CREATE_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Terminal is not available right now",
      code: "payment_service_unavailable"
    });
    expect(JSON.stringify(body)).not.toContain("STRIPE_SECRET_KEY");
    expect(JSON.stringify(body)).not.toContain("SKYLA_STRIPE_MODE");
  });

  it("maps authenticated staff role failures to forbidden without exposing raw internals", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockRejectedValueOnce(new Error("Staff role must be one of: admin, pos"));

    const response = await CREATE_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer viewer.jwt.token" } }
      )
    );

    expect(response.status).toBe(403);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Terminal is not allowed for this staff user",
      code: "staff_forbidden"
    });
    expect(JSON.stringify(body)).not.toContain("admin, pos");
  });

  it("starts Stripe Terminal through the Convex action with staff auth and no browser amount or client secret", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockResolvedValueOnce({
      saleRef: "SALE260704-ABC123",
      provider: "terminal",
      paymentIntentId: "pi_test_123",
      amountCents: 2900,
      currency: "usd",
      status: "requires_payment_method",
      clientSecret: "pi_test_secret_should_not_return",
      client_secret: "pi_test_secret_should_not_return"
    });

    const response = await CREATE_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123",
          amountCents: 1,
          currency: "eur",
          lines: [{ name: "Browser line", lineTotalCents: 1 }],
          readerId: "tmr_browser_supplied"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(200);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      paymentIntentId: "pi_test_123",
      amountCents: 2900
    });
    expect(body).not.toHaveProperty("clientSecret");
    expect(JSON.stringify(body)).not.toContain("client_secret");
    expect(JSON.stringify(body)).not.toContain("should_not_return");
    expect(fetchActionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("requires explicit POS Terminal acceptance before calling Convex", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await CREATE_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } }
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "pos_terminal_acceptance_required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });
});

describe("/api/payments/stripe-terminal/process", () => {
  it("requires staff auth before checking Convex configuration", async () => {
    const response = await PROCESS_POST(
      request({
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      }, undefined, "/api/payments/stripe-terminal/process")
    );

    expect(response.status).toBe(401);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "staff_auth_required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("fails closed when Convex is not configured after staff auth", async () => {
    const response = await PROCESS_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } },
        "/api/payments/stripe-terminal/process"
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "convex_unconfigured"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });

  it("surfaces missing reader registry failures as unavailable", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockRejectedValueOnce(new Error("Trusted Terminal reader registry is not configured"));

    const response = await PROCESS_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } },
        "/api/payments/stripe-terminal/process"
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Terminal reader processing is not available right now",
      code: "payment_service_unavailable"
    });
    expect(JSON.stringify(body)).not.toContain("Trusted Terminal reader registry");
  });

  it("maps process staff role failures to forbidden without exposing raw internals", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockRejectedValueOnce(new Error("Staff role must be one of: admin, pos"));

    const response = await PROCESS_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer viewer.jwt.token" } },
        "/api/payments/stripe-terminal/process"
      )
    );

    expect(response.status).toBe(403);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Stripe Terminal reader processing is not allowed for this staff user",
      code: "staff_forbidden"
    });
    expect(JSON.stringify(body)).not.toContain("admin, pos");
  });

  it("processes the stored Terminal PaymentIntent without browser reader or amount authority", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.SKYLA_POS_TERMINAL_ACCEPTANCE = "enabled";
    fetchActionMock.mockResolvedValueOnce({
      saleRef: "SALE260704-ABC123",
      provider: "terminal",
      paymentIntentId: "pi_test_123",
      readerId: "tmr_stored_123",
      amountCents: 2900,
      currency: "usd",
      status: "processing",
      readerStatus: "online",
      readerActionStatus: "in_progress",
      clientSecret: "pi_test_secret_should_not_return",
      client_secret: "pi_test_secret_should_not_return"
    });

    const response = await PROCESS_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123",
          amountCents: 1,
          currency: "eur",
          readerId: "tmr_browser_supplied"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } },
        "/api/payments/stripe-terminal/process"
      )
    );

    expect(response.status).toBe(200);
    expectStaffPaymentHeaders(response);
    const body = await response.json();
    expect(body).toMatchObject({
      paymentIntentId: "pi_test_123",
      readerId: "tmr_stored_123",
      amountCents: 2900,
      status: "processing"
    });
    expect(JSON.stringify(body)).not.toContain("clientSecret");
    expect(JSON.stringify(body)).not.toContain("client_secret");
    expect(JSON.stringify(body)).not.toContain("should_not_return");
    expect(fetchActionMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        saleRef: "SALE260704-ABC123",
        idempotencyKey: "pos_20260704_abc123"
      },
      { url: "https://example.convex.cloud", token: "staff.jwt.token" }
    );
  });

  it("requires explicit POS Terminal acceptance before processing on a reader", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    const response = await PROCESS_POST(
      request(
        {
          saleRef: "SALE260704-ABC123",
          idempotencyKey: "pos_20260704_abc123"
        },
        { headers: { authorization: "Bearer staff.jwt.token" } },
        "/api/payments/stripe-terminal/process"
      )
    );

    expect(response.status).toBe(503);
    expectStaffPaymentHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      code: "pos_terminal_acceptance_required"
    });
    expect(fetchActionMock).not.toHaveBeenCalled();
  });
});
