import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as createCheckoutDraft } from "./app/api/order-drafts/checkout/route";
import { POST as startStripeCheckout } from "./app/api/payments/stripe-checkout/route";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("pre-launch ticket-sales API gate", () => {
  it.each([
    [
      "checkout draft",
      createCheckoutDraft,
      new Request("https://skydeckla.com/api/order-drafts/checkout", {
        method: "POST",
        body: JSON.stringify({
          packageKey: "general",
          adults: 1,
          idempotencyKey: "checkout_prelaunch_0001"
        })
      })
    ],
    [
      "Stripe Checkout",
      startStripeCheckout,
      new Request("https://skydeckla.com/api/payments/stripe-checkout", {
        method: "POST",
        body: JSON.stringify({
          orderRef: "SKY2608-PRELAUNCH",
          idempotencyKey: "stripe_prelaunch_0001"
        })
      })
    ]
  ])("rejects %s before parsing or calling the public gateway", async (_label, handler, request) => {
    const response = await handler(request);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Sky LA is not open yet. Ticket sales are not live.",
      code: "ticket_sales_not_live"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
