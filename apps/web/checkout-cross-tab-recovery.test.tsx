// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { availabilityPayload, installCheckoutBrowserPlatform } from "./checkout-test-support";
import { CheckoutClient } from "./components/checkout-client";
import { checkoutLockName } from "./lib/checkout-recovery";

const storageKey = "skyla.checkout.paymentIntent.v1";
const paymentUrl = "/api/payments/stripe-checkout";
const statusUrl = "/api/payments/stripe-checkout/status";
const releaseUrl = "/api/order-drafts/checkout/release";
const checkoutSessionId = "cs_test_abc123xyz7890123";
const busyText = /Another tab is starting or checking a card payment right now\. No payment was started/;
const unavailableText = /This browser can't safely coordinate card payments across tabs, so no payment was started/;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function record(orderRef: string, idempotencyKey: string) {
  return JSON.stringify({ version: 1, orderRef, idempotencyKey });
}

type Body = Record<string, unknown>;
type Reply = Response | Promise<Response>;

/**
 * One fake origin server for every window. Draft reviews take the next queued
 * order reference; payment requests stay open until the test settles them;
 * status reads answer per order (pending unless a test says otherwise).
 */
function createServer() {
  const draftRefs: string[] = [];
  const payments: Array<{ body: Body } & ReturnType<typeof deferred<Response>>> = [];
  const status = new Map<string, () => Reply>();
  const statusReads: Body[] = [];
  const releases: Body[] = [];
  let returnStatus: () => Reply = () => Response.json({ status: "pending" });
  let release: () => Reply = () => Response.json({ released: true });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/availability")) {
      const params = new URL(url, "http://localhost").searchParams;
      return Response.json(availabilityPayload(params.get("date") ?? "", Number(params.get("party"))));
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Body;
    if (url === "/api/order-drafts/checkout") {
      const orderRef = draftRefs.shift();
      if (!orderRef) throw new Error("No draft reference queued");
      return Response.json({
        draft: {
          status: "draft",
          currency: "usd",
          subtotalCents: 4000,
          feeCents: 0,
          totalCents: 4000,
          orderRef,
          lines: [{ kind: "ticket", name: "The View · Adult 18+", quantity: 2, unitAmountCents: 2000, lineTotalCents: 4000 }]
        },
        orderRef,
        persisted: true
      });
    }
    if (url === paymentUrl) {
      const pending = deferred<Response>();
      payments.push({ body, ...pending });
      return pending.promise;
    }
    if (url === statusUrl) {
      if (body.checkoutSessionId) return returnStatus();
      statusReads.push(body);
      return (status.get(String(body.orderRef)) ?? (() => Response.json({ orderRef: body.orderRef, status: "pending" })))();
    }
    if (url === releaseUrl) {
      releases.push(body);
      return release();
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  return {
    fetchMock,
    draftRefs,
    payments,
    status,
    statusReads,
    releases,
    setReturnStatus(reply: () => Reply) {
      returnStatus = reply;
    },
    setRelease(reply: () => Reply) {
      release = reply;
    }
  };
}

let server: ReturnType<typeof createServer>;
let platform: ReturnType<typeof installCheckoutBrowserPlatform>;

/**
 * Another checkout React client rendered into its own container. Every client
 * here shares one document and window (one happy-dom realm) and stands in for
 * a same-origin tab only through the shared storage and lock service; genuinely
 * separate Window realms are covered in checkout-recovery.test.ts.
 */
function openClient(props: Partial<Parameters<typeof CheckoutClient>[0]> = {}) {
  const container = document.body.appendChild(document.createElement("div"));
  render(
    <CheckoutClient packages={[{ key: "general", name: "The View", priceCents: 2000 }]} addons={[]} {...props} />,
    { container }
  );
  const view = within(container);
  return Object.assign(view, {
    button: (name: string | RegExp) => view.getByRole("button", { name }) as HTMLButtonElement
  });
}

type Client = ReturnType<typeof openClient>;

async function reviewAndConsent(win: Client, orderRef: string) {
  server.draftRefs.push(orderRef);
  fireEvent.change(win.getByLabelText("Email"), { target: { value: "guest@example.com" } });
  await waitFor(() => expect(win.button("Review Order").disabled).toBe(false));
  fireEvent.click(win.button("Review Order"));
  await win.findByText(`Stored as ${orderRef}`);
  fireEvent.click(win.getByRole("checkbox", { name: /Terms of Use and Ticket Purchase Terms/i }));
  fireEvent.click(win.getByRole("checkbox", { name: /Acknowledgment of Risk and Release of Liability/i }));
  await waitFor(() => expect(win.button("Continue to Card Payment").disabled).toBe(false));
}

function reviewKey(orderIndex: number) {
  const reviews = server.fetchMock.mock.calls.filter(([url]) => String(url) === "/api/order-drafts/checkout");
  return String(JSON.parse(String(reviews[orderIndex][1]?.body)).idempotencyKey);
}

/** Another tab replaces the stored pointer the way checkout itself does: holding the lock. */
async function otherTabReplaces(raw: string) {
  const release = await platform.coordinator.hold(checkoutLockName);
  window.localStorage.removeItem(storageKey);
  window.localStorage.setItem(storageKey, raw);
  await release();
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T19:00:00.000Z"));
  window.history.replaceState({}, "", "/checkout");
  server = createServer();
  vi.stubGlobal("fetch", server.fetchMock);
  // A fresh origin storage and lock service shared by every client in a test.
  platform = installCheckoutBrowserPlatform();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  platform.restore();
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkout payment start across separate React clients", () => {
  it("lets only one of two tabs starting different orders at once send a payment, and keeps the winner's pointer", async () => {
    const first = openClient();
    const second = openClient();
    await reviewAndConsent(first, "SKY2610-FIRST");
    await reviewAndConsent(second, "SKY2610-SECOND");

    fireEvent.click(first.button("Continue to Card Payment"));
    fireEvent.click(second.button("Continue to Card Payment"));

    await waitFor(() => expect(server.payments).toHaveLength(1));
    await second.findByText(busyText);
    expect(server.payments[0].body).toMatchObject({ orderRef: "SKY2610-FIRST", idempotencyKey: reviewKey(0) });
    expect(window.localStorage.getItem(storageKey)).toBe(record("SKY2610-FIRST", reviewKey(0)));
    // The lock stays held for the whole payment request.
    expect(platform.coordinator.isHeld(checkoutLockName)).toBe(true);
    expect(platform.coordinator.contended(checkoutLockName)).toBe(1);
    await waitFor(() => expect(second.button("Continue to Card Payment").disabled).toBe(true));

    server.payments[0].resolve(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_first" }));
    await waitFor(() => expect(platform.coordinator.isHeld(checkoutLockName)).toBe(false));
    fireEvent.click(second.button("Continue to Card Payment"));
    await settle();

    expect(server.payments).toHaveLength(1);
    expect(window.localStorage.getItem(storageKey)).toBe(record("SKY2610-FIRST", reviewKey(0)));
    expect(second.button("New order").disabled).toBe(true);
    expect(second.button("Review Order").disabled).toBe(true);
  });

  it("refuses a start once the lock is free but another tab's pointer is stored", async () => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-MINE");
    const foreign = record("SKY2610-OTHER", "checkout_other_tab_key_01");
    // No storage event reaches this tab before the click.
    await otherTabReplaces(foreign);

    fireEvent.click(win.button("Continue to Card Payment"));

    await win.findByText("Another payment is already being checked. Finish checking it before starting this order.");
    expect(server.payments).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBe(foreign);
  });

  it("resumes the same payment from two tabs with the original order and key, never writing a new pointer", async () => {
    const stored = record("SKY2610-RESUME", "checkout_resume_key_0001");
    window.localStorage.setItem(storageKey, stored);
    server.status.set("SKY2610-RESUME", () => Response.json({ orderRef: "SKY2610-RESUME", status: "awaiting_payment" }));
    const setItem = vi.spyOn(Object.getPrototypeOf(window.localStorage), "setItem");
    const first = openClient();
    const second = openClient();
    await first.findByText(/A card payment for order SKY2610-RESUME is open/);
    await second.findByText(/A card payment for order SKY2610-RESUME is open/);

    fireEvent.click(first.button("Return to payment"));
    fireEvent.click(second.button("Return to payment"));
    await waitFor(() => expect(server.payments).toHaveLength(1));
    await second.findByText(busyText);

    // A failed reopen keeps the payment and its lock-held status check.
    server.payments[0].resolve(Response.json({ error: "Stripe is busy." }, { status: 503 }));
    await first.findByText("Stripe is busy.");
    await waitFor(() => expect(platform.coordinator.isHeld(checkoutLockName)).toBe(false));

    fireEvent.click(second.button("Return to payment"));
    await waitFor(() => expect(server.payments).toHaveLength(2));
    server.payments[1].resolve(Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_same" }));
    await settle();

    for (const payment of server.payments) {
      expect(payment.body).toMatchObject({ orderRef: "SKY2610-RESUME", idempotencyKey: "checkout_resume_key_0001" });
    }
    expect(setItem.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
  });
});

describe("checkout settlement across separate React clients", () => {
  it("never clears a pointer another tab replaced while an old status check was in flight", async () => {
    window.localStorage.setItem(storageKey, record("SKY2610-OLD", "checkout_old_key_000001"));
    const oldStatus = deferred<Response>();
    server.status.set("SKY2610-OLD", () => oldStatus.promise);
    const win = openClient();
    await waitFor(() => expect(server.statusReads).toHaveLength(1));

    const replacement = record("SKY2610-NEW", "checkout_new_key_000001");
    await otherTabReplaces(replacement);
    oldStatus.resolve(Response.json({ orderRef: "SKY2610-OLD", status: "canceled" }));
    await settle();

    expect(window.localStorage.getItem(storageKey)).toBe(replacement);
    expect(win.queryByText(/You can review a new order/)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });
    await win.findByText(/A card payment for order SKY2610-NEW is still being confirmed/);
    expect(win.button("New order").disabled).toBe(true);
    expect(window.localStorage.getItem(storageKey)).toBe(replacement);
  });

  it("never lets a stale confirmed Stripe return clear the same order stored with another key", async () => {
    window.history.replaceState({}, "", `/checkout?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-RET`);
    window.localStorage.setItem(storageKey, record("SKY2610-RET", "checkout_return_key_old1"));
    const returned = deferred<Response>();
    server.setReturnStatus(() => returned.promise);
    const win = openClient({ stripeStatus: "success", returnedCheckoutSessionId: checkoutSessionId });
    await waitFor(() => expect(server.fetchMock.mock.calls.some(([url]) => String(url) === statusUrl)).toBe(true));

    const replacement = record("SKY2610-RET", "checkout_return_key_new1");
    await otherTabReplaces(replacement);
    returned.resolve(Response.json({ orderRef: "SKY2610-RET", status: "confirmed", bookingRef: "SKY2610-RET" }));

    await win.findByText(/Payment confirmed\. Booking SKY2610-RET\./);
    await settle();
    expect(window.localStorage.getItem(storageKey)).toBe(replacement);
    expect(server.payments).toHaveLength(0);
  });

  it.each([
    ["throws", () => { throw new DOMException("Blocked", "SecurityError"); }],
    ["silently keeps the value", () => undefined]
  ])("keeps an ended payment locked when removing its pointer %s, then clears it on a later check", async (_label, remove) => {
    const stored = record("SKY2610-END", "checkout_end_key_000001");
    window.localStorage.setItem(storageKey, stored);
    server.status.set("SKY2610-END", () => Response.json({ orderRef: "SKY2610-END", status: "canceled" }));
    const removeItem = vi.spyOn(Object.getPrototypeOf(window.localStorage), "removeItem").mockImplementation(remove);
    const win = openClient();

    await win.findByText(/ended without payment\. This browser couldn't update its saved payment progress yet, so new orders stay locked/);
    expect(win.queryByText(/You can review a new order/)).toBeNull();
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(win.queryByRole("button", { name: "Return to payment" })).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe(stored);

    removeItem.mockRestore();
    fireEvent.click(win.button("Check payment status"));
    await win.findByText(/ended without payment\. You can review a new order\./);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(win.button("New order").disabled).toBe(false);
    expect(server.payments).toHaveLength(0);
  });

  it("keeps a confirmed Stripe return locked with its return URL when the pointer cannot be cleared", async () => {
    window.history.replaceState({}, "", `/checkout?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-PAID`);
    const stored = record("SKY2610-PAID", "checkout_paid_key_00001");
    window.localStorage.setItem(storageKey, stored);
    server.setReturnStatus(() =>
      Response.json({ orderRef: "SKY2610-PAID", status: "confirmed", bookingRef: "SKY2610-PAID", ticketCode: "tkt_0123456789abcdef0123456789abcdef" })
    );
    vi.spyOn(Object.getPrototypeOf(window.localStorage), "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const win = openClient({ stripeStatus: "success", returnedCheckoutSessionId: checkoutSessionId });

    await win.findByText(/Payment confirmed\. Booking SKY2610-PAID\..*couldn't update its saved payment progress, so new orders stay locked here/);
    expect(win.getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe("/tickets/tkt_0123456789abcdef0123456789abcdef");
    expect(window.location.search).toContain(`session_id=${checkoutSessionId}`);
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
  });

  it("clears a confirmed Stripe return's own pointer under the lock and the return URL", async () => {
    window.history.replaceState({}, "", `/checkout?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-PAID`);
    window.localStorage.setItem(storageKey, record("SKY2610-PAID", "checkout_paid_key_00001"));
    server.setReturnStatus(() => Response.json({ orderRef: "SKY2610-PAID", status: "confirmed", bookingRef: "SKY2610-PAID" }));
    const win = openClient({ stripeStatus: "success", returnedCheckoutSessionId: checkoutSessionId });

    await win.findByText(/Payment confirmed\. Booking SKY2610-PAID\. Keep this reference for admission\./);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(win.button("New order").disabled).toBe(false);
  });

  it("keeps a released not-started draft locked while another tab holds the lock, then settles on recheck", async () => {
    const stored = record("SKY2610-RACE", "checkout_race_key_00001");
    window.localStorage.setItem(storageKey, stored);
    server.status.set("SKY2610-RACE", () => Response.json({ orderRef: "SKY2610-RACE", status: "not_started" }));
    const releaseLock = await platform.coordinator.hold(checkoutLockName);
    const win = openClient();

    await win.findByText(/ended without payment\. This browser couldn't update its saved payment progress yet/);
    expect(server.releases).toEqual([{ orderRef: "SKY2610-RACE", idempotencyKey: "checkout_race_key_00001" }]);
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
    expect(win.button("New order").disabled).toBe(true);

    await releaseLock();
    server.status.set("SKY2610-RACE", () => Response.json({ orderRef: "SKY2610-RACE", status: "canceled" }));
    fireEvent.click(win.button("Check payment status"));
    await win.findByText(/ended without payment\. You can review a new order\./);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(server.payments).toHaveLength(0);
  });
});

describe("checkout refuses unsafe payment starts", () => {
  it.each([
    ["the stored pointer cannot be read", "getItem"],
    ["saving the pointer throws", "setItem-throws"],
    ["saving the pointer silently does nothing", "setItem-noop"]
  ] as const)("starts no payment when %s", async (_label, fault) => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-STORE");
    const proto = Object.getPrototypeOf(window.localStorage);
    const spy = fault === "getItem"
      ? vi.spyOn(proto, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); })
      : vi.spyOn(proto, "setItem").mockImplementation(fault === "setItem-throws"
        ? () => { throw new DOMException("Full", "QuotaExceededError"); }
        : () => undefined);

    fireEvent.click(win.button("Continue to Card Payment"));
    await win.findByText(/couldn't save your payment progress\. No payment was started/);
    spy.mockRestore();
    await settle();

    expect(server.payments).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("never overwrites a corrupt pointer written by another tab", async () => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-CORRUPT");
    window.localStorage.setItem(storageKey, "{not json");

    fireEvent.click(win.button("Continue to Card Payment"));
    await win.findByText(/saved payment progress it can't read, so no payment was started/);
    expect(server.payments).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBe("{not json");
  });

  it.each([
    ["corrupt", JSON.stringify({ version: 2, orderRef: "SKY2610-X" }), false],
    ["unreadable", record("SKY2610-HIDDEN", "checkout_hidden_key_001"), true]
  ])("locks checkout and asks for help when the stored pointer is %s on load", async (_kind, before, blockReads) => {
    window.localStorage.setItem(storageKey, before);
    if (blockReads) {
      vi.spyOn(Object.getPrototypeOf(window.localStorage), "getItem").mockImplementation(() => {
        throw new DOMException("Blocked", "SecurityError");
      });
    }
    const win = openClient();
    fireEvent.change(win.getByLabelText("Email"), { target: { value: "guest@example.com" } });

    await win.findByText(/saved card payment progress it can't read, so a new payment can't start here/);
    await settle();
    expect(win.button("Review Order").disabled).toBe(true);
    expect(win.button("New order").disabled).toBe(true);
    expect(server.statusReads).toHaveLength(0);
    vi.restoreAllMocks();
    expect(window.localStorage.getItem(storageKey)).toBe(before);
  });

  it.each([
    ["Web Locks are missing", { locks: "missing" as const }, unavailableText],
    ["the page is not a secure context", { secureContext: false }, unavailableText],
    ["the lock request rejects", { reject: true }, unavailableText],
    ["another tab holds the lock", { busy: true }, busyText]
  ])("starts no payment and keeps stored data when %s", async (_label, setup, text) => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-LOCK");
    const foreign = record("SKY2610-KEEP", "checkout_keep_key_00001");
    window.localStorage.setItem(storageKey, foreign);
    let releaseLock: (() => Promise<void>) | undefined;
    if ("busy" in setup) releaseLock = await platform.coordinator.hold(checkoutLockName);
    if ("reject" in setup) platform.coordinator.rejectRequests(new DOMException("Denied", "SecurityError"));
    if ("locks" in setup || "secureContext" in setup) {
      const storage = platform.storage;
      platform.restore();
      platform = installCheckoutBrowserPlatform({ ...setup, storage });
    }

    fireEvent.click(win.button("Continue to Card Payment"));
    await win.findByText(text);
    await settle();

    expect(server.payments).toHaveLength(0);
    expect(window.localStorage.getItem(storageKey)).toBe(foreign);
    await releaseLock?.();
  });
});

describe("checkout payment reconciliation under the lock", () => {
  it("keeps the pointer after a malformed payment response and an unknown status", async () => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-UNKNOWN");
    server.status.set("SKY2610-UNKNOWN", () => new Response("<html>bad gateway</html>", { status: 502 }));

    fireEvent.click(win.button("Continue to Card Payment"));
    await waitFor(() => expect(server.payments).toHaveLength(1));
    server.payments[0].resolve(new Response("<html>bad gateway</html>", { status: 502 }));

    await win.findByText("Card payment could not be opened.");
    await win.findByText(/We couldn't check the card payment for order SKY2610-UNKNOWN/);
    expect(window.localStorage.getItem(storageKey)).toBe(record("SKY2610-UNKNOWN", reviewKey(0)));
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Return to payment")).toBeTruthy();
    await waitFor(() => expect(platform.coordinator.isHeld(checkoutLockName)).toBe(false));
  });

  it("settles a confirmed status inside the held payment lock without contending with itself", async () => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-LOST");
    server.status.set("SKY2610-LOST", () =>
      Response.json({ orderRef: "SKY2610-LOST", status: "confirmed", ticketCode: "tkt_0123456789abcdef0123456789abcdef" })
    );

    fireEvent.click(win.button("Continue to Card Payment"));
    await waitFor(() => expect(server.payments).toHaveLength(1));
    server.payments[0].reject(new TypeError("network down"));

    await win.findByText("Payment confirmed for order SKY2610-LOST. Your ticket is ready.");
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(platform.coordinator.contended(checkoutLockName)).toBe(0);
    expect(win.button("New order").disabled).toBe(false);
  });

  it("clears a closed payment page's pointer under the held lock and starts a new order", async () => {
    const win = openClient();
    await reviewAndConsent(win, "SKY2610-CLOSED");

    fireEvent.click(win.button("Continue to Card Payment"));
    await waitFor(() => expect(server.payments).toHaveLength(1));
    server.payments[0].resolve(
      Response.json({ error: "closed", code: "payment_session_closed" }, { status: 409 })
    );

    await win.findByText(/The payment page for order SKY2610-CLOSED has closed without payment/);
    expect(win.queryByText("Stored as SKY2610-CLOSED")).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(platform.coordinator.contended(checkoutLockName)).toBe(0);
  });
});

function returnStatusReads() {
  return server.fetchMock.mock.calls.filter(
    ([url, init]) => String(url) === statusUrl && "checkoutSessionId" in JSON.parse(String(init?.body ?? "{}"))
  ).length;
}

describe("checkout ignores status replies it does not recognize", () => {
  it.each([
    ["an unknown status string", () => Response.json({ orderRef: "SKY2610-ODD", status: "unexpected" })],
    ["a Stripe return status the order check never sends", () => Response.json({ orderRef: "SKY2610-ODD", status: "expired" })],
    ["a JSON null body", () => Response.json(null)],
    ["a JSON array body", () => Response.json(["canceled"])],
    ["no order reference", () => Response.json({ status: "canceled" })]
  ])("keeps a stored payment locked and recoverable after an HTTP 200 with %s", async (_label, reply) => {
    const stored = record("SKY2610-ODD", "checkout_odd_key_000001");
    window.localStorage.setItem(storageKey, stored);
    server.status.set("SKY2610-ODD", reply);
    const win = openClient();

    await win.findByText(/We couldn't check the card payment for order SKY2610-ODD\. Check again before starting another order\./);
    await settle();
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(win.button("Return to payment")).toBeTruthy();
    expect(server.releases).toHaveLength(0);
    expect(server.payments).toHaveLength(0);
  });

  it.each([
    ["an unknown status string", { orderRef: "SKY2610-RET", status: "unexpected" }],
    ["an order-attempt status awaiting_payment", { orderRef: "SKY2610-RET", status: "awaiting_payment" }],
    ["an order-attempt status not_started", { orderRef: "SKY2610-RET", status: "not_started" }],
    ["a blank order reference", { orderRef: "  ", status: "canceled" }],
    ["a numeric order reference", { orderRef: 42, status: "confirmed" }],
    ["a JSON null body", null]
  ])("keeps the Stripe return's pointer and URL after an HTTP 200 with %s", async (_label, body) => {
    const returnSearch = `?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-RET`;
    window.history.replaceState({}, "", `/checkout${returnSearch}`);
    const stored = record("SKY2610-RET", "checkout_return_key_odd1");
    window.localStorage.setItem(storageKey, stored);
    server.setReturnStatus(() => Response.json(body));
    const win = openClient({ stripeStatus: "success", returnedCheckoutSessionId: checkoutSessionId });

    await waitFor(() => expect(returnStatusReads()).toBe(1));
    await settle();
    expect(win.getByText("We're confirming your payment. Please keep this page open.")).toBeTruthy();
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
    expect(window.location.search).toBe(returnSearch);
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(server.releases).toHaveLength(0);

    // A reload without the return still finds the payment and stays locked.
    cleanup();
    window.history.replaceState({}, "", "/checkout");
    const reloaded = openClient();
    await reloaded.findByText(/A card payment for order SKY2610-RET is still being confirmed/);
    expect(reloaded.button("New order").disabled).toBe(true);
    expect(window.localStorage.getItem(storageKey)).toBe(stored);
    expect(server.payments).toHaveLength(0);
  });
});

/**
 * removeItem really removes the value, then exactly the next read throws, as
 * a store that blocks access mid-operation would. The value is truly gone, so
 * only the failed verification read is faulty.
 */
function failReadAfterRemove() {
  const proto = Object.getPrototypeOf(window.localStorage) as Storage;
  const remove = proto.removeItem;
  const get = proto.getItem;
  let armed = false;
  let faults = 0;
  vi.spyOn(proto, "removeItem").mockImplementation(function (this: Storage, key: string) {
    remove.call(this, key);
    armed = true;
  });
  vi.spyOn(proto, "getItem").mockImplementation(function (this: Storage, key: string) {
    if (armed) {
      armed = false;
      faults += 1;
      throw new DOMException("Blocked", "SecurityError");
    }
    return get.call(this, key);
  });
  return { faults: () => faults };
}

describe("checkout keeps an unverified clear locked", () => {
  const ticketCode = "tkt_0123456789abcdef0123456789abcdef";

  it.each([
    [
      "an ended",
      "canceled",
      /The card payment for order SKY2610-HALF ended without payment\. This browser couldn't update its saved payment progress yet, so new orders stay locked/,
      /The card payment for order SKY2610-HALF ended without payment\. You can review a new order\./
    ],
    [
      "a confirmed",
      "confirmed",
      /Payment confirmed for order SKY2610-HALF\. This browser couldn't update its saved payment progress yet, so new orders stay locked/,
      /^Payment confirmed for order SKY2610-HALF\. Your ticket is ready\./
    ]
  ])("keeps %s payment locked when its pointer is removed but the read-back fails once", async (_label, status, unsettled, settled) => {
    window.localStorage.setItem(storageKey, record("SKY2610-HALF", "checkout_half_key_00001"));
    const settledReply = () => Response.json({ orderRef: "SKY2610-HALF", status, ticketCode });
    server.status.set("SKY2610-HALF", settledReply);
    const fault = failReadAfterRemove();
    const win = openClient();
    fireEvent.change(win.getByLabelText("Email"), { target: { value: "guest@example.com" } });

    await win.findByText(unsettled);
    await settle();
    expect(fault.faults()).toBe(1);
    // The pointer is really gone; only the unverified clear keeps the lock.
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(win.getByText(unsettled)).toBeTruthy();
    expect(win.queryByText(/You can review a new order/)).toBeNull();
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(win.button("Continue to Card Payment").disabled).toBe(true);
    expect(win.queryByRole("button", { name: "Return to payment" })).toBeNull();
    if (status === "confirmed") {
      expect(win.getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe(`/tickets/${ticketCode}`);
    }

    // An unknown status cannot verify the clear either, nor reopen payment.
    server.status.set("SKY2610-HALF", () => new Response("<html>bad gateway</html>", { status: 502 }));
    fireEvent.click(win.button("Check payment status"));
    await waitFor(() => expect(server.statusReads).toHaveLength(2));
    await settle();
    expect(win.getByText(unsettled)).toBeTruthy();
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(win.queryByRole("button", { name: "Return to payment" })).toBeNull();

    // A later locked check reads the empty slot and finishes recovery.
    server.status.set("SKY2610-HALF", settledReply);
    fireEvent.click(win.button("Check payment status"));
    await win.findByText(settled);
    expect(win.button("New order").disabled).toBe(false);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(fault.faults()).toBe(1);
    expect(server.payments).toHaveLength(0);
    expect(server.releases).toHaveLength(0);
  });

  it("keeps a confirmed Stripe return locked with its URL when the pointer's removal cannot be verified", async () => {
    window.history.replaceState({}, "", `/checkout?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-PAID`);
    window.localStorage.setItem(storageKey, record("SKY2610-PAID", "checkout_paid_key_00001"));
    server.setReturnStatus(() => Response.json({ orderRef: "SKY2610-PAID", status: "confirmed", bookingRef: "SKY2610-PAID" }));
    const fault = failReadAfterRemove();
    const win = openClient({ stripeStatus: "success", returnedCheckoutSessionId: checkoutSessionId });

    await win.findByText(/Payment confirmed\. Booking SKY2610-PAID\..*couldn't update its saved payment progress, so new orders stay locked here/);
    expect(fault.faults()).toBe(1);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(window.location.search).toContain(`session_id=${checkoutSessionId}`);
    expect(win.button("New order").disabled).toBe(true);
    expect(win.button("Review Order").disabled).toBe(true);
    expect(server.payments).toHaveLength(0);
  });
});

/** The props the checkout page derives from the current URL, as a reload would. */
function propsFromLocation(): Partial<Parameters<typeof CheckoutClient>[0]> {
  const params = new URLSearchParams(window.location.search);
  const stripe = params.get("stripe");
  return {
    stripeStatus: stripe === "success" || stripe === "cancel" ? stripe : undefined,
    returnedCheckoutSessionId: params.get("session_id") ?? undefined
  };
}

function returnStatusBodies() {
  return server.fetchMock.mock.calls
    .filter(([url, init]) => String(url) === statusUrl && "checkoutSessionId" in JSON.parse(String(init?.body ?? "{}")))
    .map(([, init]) => JSON.parse(String(init?.body)) as Body);
}

describe("checkout keeps a Stripe return that needs staff help across reloads", () => {
  it("keeps the return URL and lock without a saved pointer until the same Session settles", async () => {
    const returnSearch = `?stripe=success&session_id=${checkoutSessionId}&order=SKY2610-HELP`;
    window.history.replaceState({}, "", `/checkout${returnSearch}`);
    const setItem = vi.spyOn(Object.getPrototypeOf(window.localStorage), "setItem");
    const helpText = /Your payment for order SKY2610-HELP reached us, but the booking needs help from our team/;
    server.setReturnStatus(() => Response.json({ orderRef: "SKY2610-HELP", status: "needs_attention" }));

    // This browser never stored a pointer: the return URL is the only identity.
    const first = openClient(propsFromLocation());
    await first.findByText(helpText);
    fireEvent.change(first.getByLabelText("Email"), { target: { value: "guest@example.com" } });
    await settle();
    expect(returnStatusReads()).toBe(1);
    expect(window.location.search).toBe(returnSearch);
    expect(first.button("New order").disabled).toBe(true);
    expect(first.button("Review Order").disabled).toBe(true);
    expect(first.queryByRole("link", { name: "Open ticket" })).toBeNull();
    expect(first.queryByText(/Your ticket is ready/)).toBeNull();

    // A reload rebuilds the page from whatever URL survived and rechecks it.
    cleanup();
    const reloaded = openClient(propsFromLocation());
    await reloaded.findByText(helpText);
    await settle();
    expect(returnStatusReads()).toBe(2);
    expect(window.location.search).toBe(returnSearch);
    expect(reloaded.button("New order").disabled).toBe(true);
    expect(reloaded.button("Review Order").disabled).toBe(true);
    expect(reloaded.queryByRole("link", { name: "Open ticket" })).toBeNull();

    // Once staff settle the same Session, a reload confirms it and unlocks.
    cleanup();
    server.setReturnStatus(() => Response.json({ orderRef: "SKY2610-HELP", status: "confirmed", bookingRef: "SKY2610-HELP" }));
    const settled = openClient(propsFromLocation());
    await settled.findByText(/Payment confirmed\. Booking SKY2610-HELP\. Keep this reference for admission\./);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(settled.button("New order").disabled).toBe(false);
    expect(returnStatusReads()).toBe(3);

    // A later reload has no return left to check.
    cleanup();
    const after = openClient(propsFromLocation());
    await settle();
    expect(after.queryByText(/Payment confirmed/)).toBeNull();
    expect(after.button("New order").disabled).toBe(false);
    expect(returnStatusReads()).toBe(3);

    expect(returnStatusBodies()).toEqual([{ checkoutSessionId }, { checkoutSessionId }, { checkoutSessionId }]);
    expect(server.payments).toHaveLength(0);
    expect(server.statusReads).toHaveLength(0);
    expect(server.fetchMock.mock.calls.some(([url]) => String(url) === "/api/order-drafts/checkout")).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});
