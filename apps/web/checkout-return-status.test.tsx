// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutClient } from "./components/checkout-client";

const ticketCode = "tkt_0123456789abcdef0123456789abcdef";

function renderReturnedCheckout() {
  return render(
    <CheckoutClient
      packages={[{ key: "general", name: "General Admission", priceCents: 6000 }]}
      addons={[]}
      stripeStatus="success"
      returnedCheckoutSessionId="cs_test_abc123xyz7890123"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("checkout Stripe return status", () => {
  it("keeps the order reference and links a confirmed ticket", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        orderRef: "ORDER-123",
        status: "confirmed",
        bookingRef: "BOOKING-456",
        ticketCode
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderReturnedCheckout();

    await waitFor(() => {
      expect(screen.getByText(/Payment confirmed\. Booking ORDER-123 was created\./)).toBeTruthy();
    });
    expect(screen.getByText(/Booking reference BOOKING-456\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe(
      `/tickets/${ticketCode}`
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments/stripe-checkout/status",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ checkoutSessionId: "cs_test_abc123xyz7890123" })
      })
    );
  });

  it("does not expose a ticket link before confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          orderRef: "ORDER-123",
          status: "failed",
          bookingRef: "BOOKING-456",
          ticketCode
        })
      )
    );

    renderReturnedCheckout();

    await waitFor(() => {
      expect(screen.getByText("Stripe reported that the payment failed. No booking was confirmed.")).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Open ticket" })).toBeNull();
    expect(screen.queryByText(/BOOKING-456/)).toBeNull();
  });
});
