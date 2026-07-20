// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutClient } from "./components/checkout-client";

const checkoutSessionId = "cs_test_abc123xyz7890123";

function renderReturnedCheckout() {
  return render(
    <CheckoutClient
      packages={[{ key: "general", name: "The View", priceCents: 2000 }]}
      addons={[]}
      stripeStatus="success"
      returnedCheckoutSessionId={checkoutSessionId}
    />
  );
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    `/checkout?stripe=success&session_id=${checkoutSessionId}&order=ORDER-123`
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("checkout Stripe return identity", () => {
  it("preserves the return identity while confirmation is unresolved and clears it after confirmation", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderReturnedCheckout();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.location.search).toContain(`session_id=${checkoutSessionId}`);
    expect(window.location.search).toContain("order=ORDER-123");

    await act(async () => {
      resolveFetch(Response.json({ orderRef: "ORDER-123", status: "confirmed" }));
    });

    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("keeps the return identity when the authoritative status is still pending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ orderRef: "ORDER-123", status: "pending" })
    );
    vi.stubGlobal("fetch", fetchMock);

    renderReturnedCheckout();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(window.location.search).toContain(`session_id=${checkoutSessionId}`);
    expect(window.location.search).toContain("order=ORDER-123");
  });
});
