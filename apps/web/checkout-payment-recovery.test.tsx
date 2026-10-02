// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installCheckoutBrowserPlatform, routeCheckoutFetch } from "./checkout-test-support";
import { CheckoutClient } from "./components/checkout-client";

const storageKey = "skyla.checkout.paymentIntent.v1";
const orderRef = "SKY2610-RECOVER";
const storedIntent = {
  version: 1,
  orderRef,
  idempotencyKey: "checkout_recover_key_0001",
  startedAt: Date.parse("2026-10-02T19:00:00.000Z")
};

const draftResponse = (ref: string) => ({
  draft: {
    status: "draft",
    currency: "usd",
    subtotalCents: 4000,
    feeCents: 0,
    totalCents: 4000,
    orderRef: ref,
    lines: [{ kind: "ticket", name: "The View · Adult 18+", quantity: 2, unitAmountCents: 2000, lineTotalCents: 4000 }]
  },
  orderRef: ref,
  persisted: true
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderCheckout(props: Partial<Parameters<typeof CheckoutClient>[0]> = {}) {
  return render(
    <CheckoutClient packages={[{ key: "general", name: "The View", priceCents: 2000 }]} addons={[]} {...props} />
  );
}

function button(name: string | RegExp) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function reviewAndConsent(router: ReturnType<typeof routeCheckoutFetch>, ref = orderRef) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "guest@example.com" } });
  await waitFor(() => expect(button("Review Order").disabled).toBe(false));
  router.queue.push(Response.json(draftResponse(ref)));
  fireEvent.click(button("Review Order"));
  await screen.findByText(`Stored as ${ref}`);
  fireEvent.click(screen.getByRole("checkbox", { name: /Terms of Use and Ticket Purchase Terms/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Acknowledgment of Risk and Release of Liability/i }));
}

function paymentBodies(router: ReturnType<typeof routeCheckoutFetch>) {
  return router.paymentCalls().map(([, init]) => JSON.parse(String(init?.body)));
}

let platform: ReturnType<typeof installCheckoutBrowserPlatform>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T19:00:00.000Z"));
  platform = installCheckoutBrowserPlatform();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  platform.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkout payment safeguards", () => {
  it("locks new purchases on an uncertain Stripe return even without saved browser storage", async () => {
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "needs_attention" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout({ stripeStatus: "success", returnedCheckoutSessionId: "cs_test_abc123xyz7890123" });
    await screen.findByText(/reached us, but the booking needs help/);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(button("New order").disabled).toBe(true);
    expect(button("Review Order").disabled).toBe(true);
    expect(router.paymentCalls()).toHaveLength(0);
  });
  it("starts no payment when the private recovery identity cannot be saved", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await reviewAndConsent(router);
    const spy = vi.spyOn(Object.getPrototypeOf(window.localStorage), "setItem")
      .mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      fireEvent.click(button("Continue to Card Payment"));
      await screen.findByText(/couldn't save your payment progress\. No payment was started/);
      expect(router.paymentCalls()).toHaveLength(0);
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it("atomically abandons a not-started draft before allowing a new purchase after reload", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "not_started" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await screen.findByText(/ended without payment/);
    expect(router.releaseCalls()).toHaveLength(1);
    expect(JSON.parse(String(router.releaseCalls()[0][1]?.body))).toEqual({ orderRef, idempotencyKey: storedIntent.idempotencyKey });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(router.paymentCalls()).toHaveLength(0);
  });

  it("keeps the original intent locked if begin-payment wins the abandonment race", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "not_started" }));
    const originalFetch = router.fetchMock.getMockImplementation()!;
    router.fetchMock.mockImplementation((url, init) => String(url).endsWith("/release")
      ? Promise.resolve(Response.json({ released: false })) : originalFetch(url, init));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await screen.findByText(/still being confirmed/);
    expect(button("New order").disabled).toBe(true);
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    expect(router.paymentCalls()).toHaveLength(0);
  });
  it("sends one payment request for a double click and remembers the started order", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await reviewAndConsent(router);
    const pending = deferred<Response>();
    router.queue.push(pending.promise);

    fireEvent.click(button("Continue to Card Payment"));
    fireEvent.click(button(/Starting|Continue to Card Payment/));

    await waitFor(() => expect(router.paymentCalls()).toHaveLength(1));
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toMatchObject({ version: 1, orderRef });
    expect(window.localStorage.getItem(storageKey)).not.toContain("guest@example.com");
    pending.resolve(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_double" }));
    await new Promise((settle) => setTimeout(settle, 20));
    expect(router.paymentCalls()).toHaveLength(1);
  });

  it("keeps an uncertain payment locked after a lost response and retries the same order and key", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await reviewAndConsent(router);
    router.queue.push(Promise.reject(new TypeError("network down")));
    router.queue.push(Response.json({ orderRef, status: "pending" }));

    fireEvent.click(button("Continue to Card Payment"));

    await screen.findByText(/couldn't confirm that the payment page opened/);
    await screen.findByText(/still being confirmed\. Please don't start another payment yet/);
    expect(button("Continue to Card Payment").disabled).toBe(true);
    expect(button("Review Order").disabled).toBe(true);
    expect(button("New order").disabled).toBe(true);

    router.queue.push(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_same" }));
    fireEvent.click(button("Return to payment"));
    await waitFor(() => expect(router.paymentCalls()).toHaveLength(2));
    const [first, retry] = paymentBodies(router);
    expect(retry.orderRef).toBe(first.orderRef);
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("recovers an open payment after a reload without creating a new order", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(
      Response.json({ orderRef, status: "awaiting_payment", expiresAt: Date.parse("2026-10-02T19:45:00.000Z") })
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText(/A card payment for order SKY2610-RECOVER is open until 12:45 PM PT/);
    const [, statusInit] = router.orderCalls()[0];
    expect(JSON.parse(String(statusInit?.body))).toEqual({
      orderRef,
      idempotencyKey: storedIntent.idempotencyKey
    });
    expect(button("Review Order").disabled).toBe(true);
    expect(button("New order").disabled).toBe(true);

    router.queue.push(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_open" }));
    fireEvent.click(button("Return to payment"));
    await waitFor(() => expect(router.paymentCalls()).toHaveLength(1));
    expect(paymentBodies(router)[0]).toMatchObject({ orderRef, idempotencyKey: storedIntent.idempotencyKey });
    expect(router.orderCalls().some(([url]) => String(url) === "/api/order-drafts/checkout")).toBe(false);
  });

  it("keeps the lock when the guest comes back from Stripe without paying", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "awaiting_payment" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout({ stripeStatus: "cancel" });

    await screen.findByText("Payment was not completed.");
    await screen.findByText(/A card payment for order SKY2610-RECOVER is open\./);
    expect(button("Review Order").disabled).toBe(true);
  });

  it("unlocks only after the stored payment ended without payment", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "canceled" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText(/ended without payment\. You can review a new order\./);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(button("New order").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Return to payment" })).toBeNull();
  });

  it("shows the ticket after a reload once the stored payment is confirmed, and unlocks new orders", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(
      Response.json({ orderRef, status: "confirmed", bookingRef: orderRef, ticketCode: "tkt_0123456789abcdef0123456789abcdef" })
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText("Payment confirmed for order SKY2610-RECOVER. Your ticket is ready.");
    expect(screen.getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe(
      "/tickets/tkt_0123456789abcdef0123456789abcdef"
    );
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(button("New order").disabled).toBe(false);
  });

  it("tells a paid guest whose booking needs help not to pay again, with no ticket link", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "needs_attention" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText(/needs help from our team before a ticket can be issued\. Please don't pay again/);
    expect(screen.queryByRole("link", { name: "Open ticket" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to payment" })).toBeNull();
    expect(button("Review Order").disabled).toBe(true);
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
  });

  it("reports a Stripe return that needs staff help without claiming a booking", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "needs_attention" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout({ stripeStatus: "success", returnedCheckoutSessionId: "cs_test_abc123xyz7890123" });

    await screen.findByText(/reached us, but the booking needs help from our team/);
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open ticket" })).toBeNull();
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
  });

  it("releases a replaced draft, but never the order whose payment was started", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    await reviewAndConsent(router, "SKY2610-FIRST");
    const firstKey = JSON.parse(String(router.orderCalls()[0][1]?.body)).idempotencyKey;

    fireEvent.click(button("More adults"));
    await waitFor(() => expect(router.releaseCalls()).toHaveLength(1));
    expect(JSON.parse(String(router.releaseCalls()[0][1]?.body))).toEqual({
      orderRef: "SKY2610-FIRST",
      idempotencyKey: firstKey
    });

    await reviewAndConsent(router, "SKY2610-SECOND");
    router.queue.push(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_second" }));
    fireEvent.click(button("Continue to Card Payment"));
    await waitFor(() => expect(router.paymentCalls()).toHaveLength(1));
    fireEvent.click(button("Fewer adults"));
    await new Promise((settle) => setTimeout(settle, 20));
    expect(router.releaseCalls()).toHaveLength(1);
  });

  it("keeps recovery controls on the 44px touch-target classes", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(storedIntent));
    const router = routeCheckoutFetch();
    router.queue.push(Response.json({ orderRef, status: "pending" }));
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText(/still being confirmed/);
    expect(button("Return to payment").className).toBe("secondaryAction");
    expect(button("Check payment status").className).toBe("checkoutTextButton");
    const css = readFileSync(join(import.meta.dirname, "app/styles/checkout.css"), "utf8");
    expect(css).toMatch(/\.checkoutTextButton\s*\{[^}]*min-height:\s*44px/);
  });
});
