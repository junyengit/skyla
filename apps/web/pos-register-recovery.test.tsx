// @vitest-environment happy-dom
// Register recovery boundaries. Staff fetch, server responses and the Web
// Locks manager are in-memory stand-ins: these prove the UI and helper
// contracts (frozen review, pending payment authority, cross-tab refusal,
// compare-before-clear, honest storage and ticket wording), not real Clerk
// authorization, a browser's lock manager or a Stripe payment.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { checkoutEntryTimes } from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ status: "signed-in", staffFetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/staff-auth-provider", () => ({ useStaffSession: () => ({ ...session, email: "register@skydeckla.com" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pos" }));

import { PosDraftClient, PosSaleOutcome } from "./components/pos-draft-client";
import {
  activeSaleStorageKey as storageKey,
  clearActiveSale,
  lockRefusalMessage,
  registerLockName,
  saleStatusMessage,
  storeActiveSale,
  ticketStanding,
  withRegisterLock,
  type SaleOutcome
} from "./lib/pos-recovery";

const saleA = { version: 1, saleRef: "SALE261002-AAAAAA", idempotencyKey: "pos_restore_aaaaaa" } as const;
const saleB = { version: 1, saleRef: "SALE261002-BBBBBB", idempotencyKey: "pos_restore_bbbbbb" } as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

type Handler = (body?: Record<string, unknown>) => Promise<Response> | Response;
type ServerSale = Record<string, unknown> & { paymentState: string };
let server: {
  sale: ServerSale | null;
  requests: Array<{ url: string; body?: Record<string, unknown> }>;
  override: Record<string, Handler>;
};
let heldLocks: Set<string>;

function saleStatus(paymentState: string, extra: Record<string, unknown> = {}): ServerSale {
  return {
    saleRef: saleA.saleRef,
    status: paymentState === "draft" ? "draft" : paymentState.startsWith("paid") ? "paid" : "payment_pending",
    paymentState,
    currency: "usd",
    subtotalCents: 5000,
    feeCents: 0,
    totalCents: 5000,
    visitDate: "2026-10-03",
    entryTime: "14:00",
    party: { adults: 2, youths: 1, children: 2, total: 5 },
    lines: [
      { kind: "ticket", name: "Adult 18+", quantity: 2, unitAmountCents: 2000, lineTotalCents: 4000 },
      { kind: "ticket", name: "Youth 8–17", quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000 },
      { kind: "ticket", name: "Child 0–7", quantity: 2, unitAmountCents: 0, lineTotalCents: 0 }
    ],
    readerId: "tmr_front123",
    readerRetryAllowed: paymentState === "awaiting_payment",
    ticketIssued: false,
    admissionUsed: false,
    updatedAt: 1790000000000,
    ...extra
  };
}

function draftResponse() {
  return json({
    persisted: true,
    saleRef: saleA.saleRef,
    draft: { status: "draft", currency: "usd", subtotalCents: 3000, feeCents: 0, totalCents: 3000, visitDate: "2026-10-03", entryTime: "14:00", readerId: "tmr_front123", lines: [] }
  });
}

function installLocks() {
  heldLocks = new Set<string>();
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
        if (heldLocks.has(name)) return callback(null);
        heldLocks.add(name);
        try {
          return await callback({ name });
        } finally {
          heldLocks.delete(name);
        }
      }
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-02T19:00:00.000Z"));
  window.localStorage.clear();
  installLocks();
  server = { sale: null, requests: [], override: {} };
  session.status = "signed-in";
  session.signOut.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const params = new URL(String(url), "https://skydeckla.com").searchParams;
    return json({
      visitDate: params.get("date"),
      timeZone: "America/Los_Angeles",
      today: "2026-10-02",
      weekday: "Friday",
      capacity: 30,
      partySize: Number(params.get("party")),
      dayStatus: "open",
      dayHours: { open: "10:00", close: "22:00", closed: false },
      slots: checkoutEntryTimes.map(({ value }) => ({ entryTime: value, status: "available", remaining: 12 }))
    });
  }));
  session.staffFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    server.requests.push({ url, body });
    if (server.override[url]) return server.override[url](body);
    if (url === "/api/pos/readers") {
      return json({ staff: { emailLower: "register@skydeckla.com", role: "pos" }, readers: [{ label: "Front", readerId: "tmr_front123" }] });
    }
    if (url === "/api/order-drafts/pos") {
      server.sale = saleStatus("draft");
      return draftResponse();
    }
    if (url === "/api/payments/stripe-terminal") {
      server.sale = saleStatus("awaiting_payment");
      return json({ saleRef: saleA.saleRef, status: "open" });
    }
    if (url === "/api/payments/stripe-terminal/process") return json({ status: "processing" });
    if (url === "/api/payments/stripe-terminal/status") return server.sale ? json(server.sale) : json({ error: "missing", code: "pos_sale_not_found" }, 404);
    if (url === "/api/pos/sale-release") {
      server.sale = saleStatus("closed");
      return json({ released: true });
    }
    throw new Error(`Unexpected staff request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as { locks?: unknown }).locks;
});

const requestsTo = (url: string) => server.requests.filter((request) => request.url === url);
const stored = () => window.localStorage.getItem(storageKey);

async function prepareParty(scope: Pick<typeof screen, "getByRole" | "getByLabelText" | "findByText"> = screen) {
  fireEvent.click(scope.getByRole("button", { name: "Load Readers" }));
  await scope.findByText("1 authorized reader loaded.");
  fireEvent.click(scope.getByRole("button", { name: "One more Adult 18+" }));
  fireEvent.click(scope.getByRole("button", { name: "One more Youth 8–17" }));
  fireEvent.change(scope.getByLabelText("Date"), { target: { value: "2026-10-03" } });
  fireEvent.change(scope.getByLabelText("Entry time"), { target: { value: "14:00" } });
}

async function reviewedSale() {
  const view = render(<PosDraftClient cafeItems={[]} terminalAccepted />);
  await prepareParty();
  fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
  await screen.findByRole("button", { name: "Send to Reader" });
  return view;
}

/** The in-lock pre-send read succeeds; every later status read uses `handler`. */
function failStatusAfterPreRead(handler: Handler) {
  let reads = 0;
  server.override["/api/payments/stripe-terminal/status"] = (body) => {
    reads += 1;
    return reads === 1 ? json(server.sale) : handler(body);
  };
}

function expectNoNewSaleControls() {
  for (const name of ["Send to Reader", "Change Sale", "Clear Sale", "Start New Sale", "Review Sale"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
}

describe("review freezes what it sends", () => {
  it("refuses same-frame and in-flight edits so the stored sale matches the screen", async () => {
    const review = deferred<Response>();
    server.override["/api/order-drafts/pos"] = () => review.promise;
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await prepareParty();
    const email = screen.getByLabelText("Email for ticket") as HTMLInputElement;
    const reviewButton = screen.getByRole("button", { name: "Review Sale" });
    const moreAdults = screen.getByRole("button", { name: "One more Adult 18+" });
    fireEvent.change(email, { target: { value: "a@example.com" } });

    // Handlers are hit back to back with elements captured before the click,
    // so the synchronous action guard, not only disabled props, refuses them.
    act(() => {
      fireEvent.click(reviewButton);
      fireEvent.change(email, { target: { value: "b@example.com" } });
      fireEvent.click(moreAdults);
      fireEvent.click(reviewButton);
    });
    expect(email.value).toBe("a@example.com");
    expect(email.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "One more Adult 18+" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Load Readers" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Clear Sale" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(email, { target: { value: "c@example.com" } });
    expect(email.value).toBe("a@example.com");

    await act(async () => review.resolve(draftResponse()));
    await screen.findByRole("button", { name: "Send to Reader" });
    const sent = requestsTo("/api/order-drafts/pos");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ customerEmail: "a@example.com", admission: { adults: 1, children: 1 } });
    expect(email.value).toBe("a@example.com");
    expect(screen.getByText("1 adult, 1 youth")).toBeTruthy();
  });

  it("keeps the same review key after a lost reply so a retry recovers the same sale", async () => {
    server.override["/api/order-drafts/pos"] = () => json({ error: "Could not persist POS sale draft" }, 502);
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await prepareParty();
    fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
    await screen.findByText(/may already be stored. Review again without changes/);
    expect(stored()).toBeNull();

    delete server.override["/api/order-drafts/pos"];
    fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
    await screen.findByRole("button", { name: "Send to Reader" });
    const [first, second] = requestsTo("/api/order-drafts/pos");
    expect(second.body?.idempotencyKey).toBe(first.body?.idempotencyKey);
  });

  it("keeps editing available signed out while review stays staff-only", () => {
    session.status = "signed-out";
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    fireEvent.click(screen.getByRole("button", { name: "One more Adult 18+" }));
    expect(screen.getByLabelText("Adult 18+ count").textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Review Sale" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("payment authority while a request is in flight", () => {
  it.each(["sign-out", "session replacement"] as const)(
    "stops reader processing when %s changes the staff session during intent creation",
    async (change) => {
      const view = await reviewedSale();
      const recovery = stored();
      const create = deferred<Response>();
      server.override["/api/payments/stripe-terminal"] = () => {
        // The server has accepted this same payment, but its response has not
        // reached the cashier yet. Losing the session must retain recovery.
        server.sale = saleStatus("awaiting_payment");
        return create.promise;
      };

      fireEvent.click(screen.getByRole("button", { name: "Send to Reader" }));
      await waitFor(() => expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1));
      expect(screen.getByText(/Sending the payment to the reader. Do not charge again./)).toBeTruthy();
      expect(heldLocks.has(registerLockName)).toBe(true);

      if (change === "sign-out") {
        session.signOut.mockImplementation(async () => { session.status = "signed-out"; });
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        await waitFor(() => expect(session.signOut).toHaveBeenCalledTimes(1));
        view.rerender(<PosDraftClient cafeItems={[]} terminalAccepted />);
      } else {
        // StaffAuthProvider replaces its keyed subtree when the signed-in
        // identity changes. The previous cashier's closure stays in flight.
        view.unmount();
        render(<PosDraftClient cafeItems={[]} terminalAccepted />);
      }

      expect(stored()).toBe(recovery);
      expect(heldLocks.has(registerLockName)).toBe(true);
      await act(async () => create.resolve(json({ saleRef: saleA.saleRef, status: "open" })));
      await waitFor(() => expect(heldLocks.has(registerLockName)).toBe(false));

      expect(requestsTo("/api/payments/stripe-terminal/process")).toHaveLength(0);
      expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1);
      expect(requestsTo("/api/pos/sale-release")).toHaveLength(0);
      expect(stored()).toBe(recovery);
      expect(JSON.parse(stored() ?? "null")).toMatchObject({ saleRef: saleA.saleRef });
      expect(screen.queryByText(/Sent to the reader\. Wait for Stripe to confirm/)).toBeNull();
      expect(screen.queryByText(/Payment confirmed/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Send to Reader" })).toBeNull();
    }
  );

  it("drops draft controls before the first request and stays unconfirmed when create and status both fail", async () => {
    await reviewedSale();
    const create = deferred<Response>();
    server.override["/api/payments/stripe-terminal"] = () => create.promise;
    failStatusAfterPreRead(() => json({ error: "Status service unavailable" }, 502));

    fireEvent.click(screen.getByRole("button", { name: "Send to Reader" }));
    expect(screen.getByText(/Sending the payment to the reader. Do not charge again./)).toBeTruthy();
    expectNoNewSaleControls();

    await act(async () => create.reject(new TypeError("Network connection lost")));
    await screen.findByText(/Payment outcome not confirmed. Do not charge again; use Refresh Status./);
    await screen.findByText(/Status service unavailable. The sale stays locked/);
    expectNoNewSaleControls();
    expect(screen.getByRole("button", { name: "Refresh Status" }).hasAttribute("disabled")).toBe(false);
    expect(requestsTo("/api/payments/stripe-terminal/process")).toHaveLength(0);
    expect(JSON.parse(stored() ?? "null")).toMatchObject({ saleRef: saleA.saleRef });
  });

  it("keeps a failed process plus failed status read locked until a later authoritative read", async () => {
    await reviewedSale();
    server.override["/api/payments/stripe-terminal/process"] = () => json({ error: "Reader offline" }, 502);
    failStatusAfterPreRead(() => {
      throw new TypeError("Failed to fetch");
    });

    fireEvent.click(screen.getByRole("button", { name: "Send to Reader" }));
    await screen.findByText(/Reader offline. The payment may have started; do not charge again./);
    await screen.findByText(/Payment outcome not confirmed/);
    expectNoNewSaleControls();

    delete server.override["/api/payments/stripe-terminal/status"];
    server.sale = saleStatus("awaiting_payment");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    await screen.findByRole("button", { name: "Send Same Payment Again" });
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Change Sale" })).toBeNull();
  });

  it("returns to a stored sale after reload with a status read only", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("awaiting_payment");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await screen.findByText(/Waiting for the card on the reader/);
    expect(server.requests.map((request) => request.url)).toEqual(["/api/payments/stripe-terminal/status"]);
    expect(server.requests[0].body).toEqual({ saleRef: saleA.saleRef, refresh: false });
  });

  it("keeps the lock when the server has no record of the stored sale", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await screen.findByText(/The server has no record of sale SALE261002-AAAAAA; it stays locked here/);
    expect(stored()).not.toBeNull();
    expectNoNewSaleControls();
  });

  it("drops a replaced session's async results after a keyed remount", async () => {
    const review = deferred<Response>();
    server.override["/api/order-drafts/pos"] = () => review.promise;
    const { rerender } = render(<PosDraftClient key="first" cafeItems={[]} terminalAccepted={false} />);
    await prepareParty();
    fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
    rerender(<PosDraftClient key="second" cafeItems={[]} terminalAccepted={false} />);

    server.sale = saleStatus("draft");
    await act(async () => review.resolve(draftResponse()));
    // The durable pointer is kept so the sale is never orphaned; the new
    // session reads it from the server rather than the old view's reply.
    await screen.findByText(/Reviewed. Send it to the reader/);
    expect(screen.queryByText(/Reader payments are switched off on this register/)).toBeNull();
    expect(requestsTo("/api/payments/stripe-terminal/status")).toHaveLength(1);
    expect(JSON.parse(stored() ?? "null")).toMatchObject({ saleRef: saleA.saleRef });
  });
});

describe("one sale per register across tabs", () => {
  it("refuses a second tab's review while the first holds the register lock", async () => {
    const review = deferred<Response>();
    server.override["/api/order-drafts/pos"] = () => review.promise;
    const tabA = within(render(<PosDraftClient cafeItems={[]} terminalAccepted />).container);
    const tabB = within(render(<PosDraftClient cafeItems={[]} terminalAccepted />).container);
    await prepareParty(tabA);
    await prepareParty(tabB);

    fireEvent.click(tabA.getByRole("button", { name: "Review Sale" }));
    await waitFor(() => expect(requestsTo("/api/order-drafts/pos")).toHaveLength(1));
    fireEvent.click(tabB.getByRole("button", { name: "Review Sale" }));
    await tabB.findByText(lockRefusalMessage.busy);
    expect(requestsTo("/api/order-drafts/pos")).toHaveLength(1);

    await act(async () => review.resolve(draftResponse()));
    await tabA.findByRole("button", { name: "Send to Reader" });
    // Tab B now sees the stored sale and is locked to it.
    await waitFor(() => expect(tabB.queryByRole("button", { name: "Review Sale" })).toBeNull());
    expect(JSON.parse(stored() ?? "null")).toMatchObject({ saleRef: saleA.saleRef });
  });

  it("withdraws a lock-busy tab's cached actions until a lock-held read after the other writer finishes", async () => {
    const tabA = within(render(<PosDraftClient cafeItems={[]} terminalAccepted />).container);
    const tabB = within(render(<PosDraftClient cafeItems={[]} terminalAccepted />).container);
    await prepareParty(tabA);
    fireEvent.click(tabA.getByRole("button", { name: "Review Sale" }));
    await tabA.findByRole("button", { name: "Send to Reader" });
    // Tab B picks up the stored sale and caches its draft actions.
    await tabB.findByRole("button", { name: "Send to Reader" });

    // Tab A launches payment and holds the register lock on a deferred create.
    const create = deferred<Response>();
    server.override["/api/payments/stripe-terminal"] = () => create.promise;
    fireEvent.click(tabA.getByRole("button", { name: "Send to Reader" }));
    await waitFor(() => expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1));

    fireEvent.click(tabB.getByRole("button", { name: "Send to Reader" }));
    await tabB.findByText(/Another register tab is working on this sale. Do not charge again from here/);
    const withdrawn = ["Send to Reader", "Change Sale", "Clear Sale", "Start New Sale", "Review Sale"];
    for (const name of withdrawn) expect(tabB.queryByRole("button", { name })).toBeNull();

    // The server still answers "draft" while A is mid-write; B's Refresh must
    // not take that answer as authority.
    expect(server.sale?.paymentState).toBe("draft");
    const readsBefore = requestsTo("/api/payments/stripe-terminal/status").length;
    fireEvent.click(tabB.getByRole("button", { name: "Refresh Status" }));
    await waitFor(() => expect(tabB.getByRole("button", { name: "Refresh Status" }).hasAttribute("disabled")).toBe(false));
    expect(requestsTo("/api/payments/stripe-terminal/status")).toHaveLength(readsBefore);
    for (const name of withdrawn) expect(tabB.queryByRole("button", { name })).toBeNull();
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1);

    // A finishes; a lock-held read in B now restores only the correct action.
    server.sale = saleStatus("awaiting_payment");
    await act(async () => create.resolve(json({ saleRef: saleA.saleRef, status: "open" })));
    await waitFor(() => expect(requestsTo("/api/payments/stripe-terminal/process")).toHaveLength(1));
    await tabA.findByText(/Waiting for the card on the reader/);
    fireEvent.click(tabB.getByRole("button", { name: "Refresh Status" }));
    await tabB.findByRole("button", { name: "Send Same Payment Again" });
    for (const name of withdrawn) expect(tabB.queryByRole("button", { name })).toBeNull();
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1);
  });

  it("re-reads under the lock and sends nothing when the cached draft is obsolete", async () => {
    await reviewedSale();
    // Another writer already moved the sale on; this screen still shows draft.
    server.sale = saleStatus("awaiting_payment");
    fireEvent.click(screen.getByRole("button", { name: "Send to Reader" }));
    await screen.findByText(/This sale changed since this screen last read it, so nothing was sent/);
    await screen.findByRole("button", { name: "Send Same Payment Again" });
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(0);
    expect(requestsTo("/api/payments/stripe-terminal/process")).toHaveLength(0);
  });

  it("keeps a contended Start New Sale withdrawn until a lock-held read", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("closed");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const startNew = await screen.findByRole("button", { name: "Start New Sale" });
    heldLocks.add("skyla:pos-register-sale");
    fireEvent.click(startNew);
    await screen.findByText(/Another register tab is working on this sale/);
    expect(screen.queryByRole("button", { name: "Start New Sale" })).toBeNull();
    expect(stored()).not.toBeNull();

    heldLocks.clear();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start New Sale" }));
    await screen.findByRole("button", { name: "Review Sale" });
    expect(stored()).toBeNull();
  });

  it("will not start or change a sale without Web Locks but still reads status", async () => {
    Object.defineProperty(window.navigator, "locks", { configurable: true, value: null });
    expect(lockRefusalMessage.unavailable).toBe(
      "This browser cannot safely coordinate register tabs, so it will not start or change a sale. Nothing was sent."
    );
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await prepareParty();
    fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
    await screen.findByText(lockRefusalMessage.unavailable);
    expect(requestsTo("/api/order-drafts/pos")).toHaveLength(0);
    cleanup();

    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("draft");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Reader" }));
    await screen.findByText((text) => text.includes(lockRefusalMessage.unavailable));
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(0);
    expect(screen.queryByText(/Web Locks/)).toBeNull();
  });

  it("never clears a newer sale saved after this view loaded", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("closed");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const startNew = await screen.findByRole("button", { name: "Start New Sale" });
    // Written without a change event, as by a register build that skipped the lock.
    window.localStorage.setItem(storageKey, JSON.stringify(saleB));
    fireEvent.click(startNew);
    await screen.findByText(/Another sale is now saved on this register and was left in place./);
    expect(JSON.parse(stored() ?? "null")).toMatchObject({ saleRef: saleB.saleRef });
  });
});

describe("storage and release stay honest", () => {
  it("treats damaged or unreadable storage as an open sale, not as no sale", async () => {
    window.localStorage.setItem(storageKey, "{not json");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    expect(screen.getByText(/saved register sale on this browser is damaged/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
    expect(screen.getByRole("button", { name: "One more Adult 18+" }).hasAttribute("disabled")).toBe(true);
    expect(stored()).toBe("{not json");
    cleanup();

    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render(<PosDraftClient cafeItems={[]} terminalAccepted />);
      expect(screen.getByText(/cannot read its saved register sale/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
      expect(server.requests).toHaveLength(0);
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps an unsaved review locked with payment off when its release is not confirmed", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      server.override["/api/pos/sale-release"] = () => {
        throw new TypeError("Network connection lost");
      };
      render(<PosDraftClient cafeItems={[]} terminalAccepted />);
      await prepareParty();
      fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
      await screen.findByText(/could not save the sale for recovery, so payment stays off here. Its release was not confirmed/);
      expect(screen.queryByText(/review was released|released the review/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Send to Reader" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();

      delete server.override["/api/pos/sale-release"];
      fireEvent.click(screen.getByRole("button", { name: "Clear Sale" }));
      await screen.findByText("Sale cleared and its places released.");
      expect(screen.getByRole("button", { name: "Review Sale" })).toBeTruthy();
    } finally {
      setItem.mockRestore();
    }
  });

  it("does not claim a release when the release request is lost or malformed", async () => {
    await reviewedSale();
    server.override["/api/pos/sale-release"] = () => {
      throw new TypeError("Network connection lost");
    };
    fireEvent.click(screen.getByRole("button", { name: "Change Sale" }));
    await screen.findByText(/Network connection lost. The release was not confirmed, so the sale stays locked./);
    expect(screen.getByText(/Release not confirmed. The sale stays locked; use Refresh Status./)).toBeTruthy();
    expect(stored()).not.toBeNull();
    expectNoNewSaleControls();

    server.override["/api/pos/sale-release"] = () => json({});
    server.sale = saleStatus("draft");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change Sale" }));
    await screen.findByText(/Could not release this sale. The release was not confirmed/);
    expect(stored()).not.toBeNull();
  });

  it("keeps the pointer when the release lands but the browser cannot clear it", async () => {
    await reviewedSale();
    const removeItem = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Change Sale" }));
      await screen.findByText(/places were released, but this browser could not clear its saved sale/);
      await screen.findByText(/This sale closed without payment./);
      expect(stored()).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Start New Sale" }));
      await screen.findByText(/could not clear the finished sale, so the register stays on it/);
      expect(stored()).not.toBeNull();
    } finally {
      removeItem.mockRestore();
    }
  });
});

describe("a malformed 200 status answer is never authority", () => {
  const usablePaid = () =>
    saleStatus("paid", {
      bookingRef: saleA.saleRef,
      bookingStatus: "confirmed",
      ticketIssued: true,
      admissionUsed: false,
      ticketCode: "tkt_0123456789abcdef0123456789abcdef"
    });
  const without = (key: string) => {
    const sale = usablePaid();
    delete sale[key];
    return sale;
  };
  const malformed: Array<[string, unknown]> = [
    ["null JSON", null],
    ["an array", [usablePaid()]],
    ["an unknown paymentState", { ...usablePaid(), paymentState: "settled" }],
    ["a null paymentState", { ...usablePaid(), paymentState: null }],
    ["an unknown sale status", { ...usablePaid(), status: "complete" }],
    ["a missing sale status", without("status")],
    ["a partial success object", { saleRef: saleA.saleRef, paymentState: "paid" }],
    ["a missing ticketIssued", without("ticketIssued")],
    ["a missing admissionUsed", without("admissionUsed")],
    ["a missing readerRetryAllowed", without("readerRetryAllowed")],
    ["a non-USD currency", { ...usablePaid(), currency: "eur" }],
    ["a missing currency", without("currency")],
    ["negative money", { ...usablePaid(), totalCents: -5000 }],
    ["fractional money", { ...usablePaid(), feeCents: 0.5 }],
    ["string money", { ...usablePaid(), subtotalCents: "5000" }],
    ["missing lines", without("lines")],
    ["a line with string quantity", { ...usablePaid(), lines: [{ kind: "cafe", name: "Matcha", quantity: "1", unitAmountCents: 600, lineTotalCents: 600 }] }],
    ["a null line", { ...usablePaid(), lines: [null] }],
    ["a malformed ticket code", { ...usablePaid(), ticketCode: "../admin" }],
    ["an impossible visit date", { ...usablePaid(), visitDate: "2026-13-45" }],
    ["a malformed party", { ...usablePaid(), party: { adults: "2", youths: 1, children: 2, total: 5 } }],
    ["a different sale", { ...usablePaid(), saleRef: saleB.saleRef }]
  ];

  function expectLockedForRecovery(pointer: unknown = saleA) {
    expect(JSON.parse(stored() ?? "null")).toEqual(pointer);
    for (const name of ["Send to Reader", "Send Same Payment Again", "Change Sale", "Clear Sale", "Start New Sale", "Review Sale"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Refresh Status" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Paid|Reviewed|not charged|closed without payment|issued ticket/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open admission ticket" })).toBeNull();
    expect(screen.queryByLabelText("Paid sale receipt")).toBeNull();
  }

  it.each(malformed)("keeps a reloaded sale locked on %s", async (_label, body) => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.override["/api/payments/stripe-terminal/status"] = () => json(body);
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await screen.findByText(/sale status was incomplete, so nothing about this sale changed here. The sale stays locked; use Refresh Status./);
    expectLockedForRecovery();
  });

  it("keeps a pending payment unconfirmed on a partial draft answer, then recovers on a complete re-read", async () => {
    await reviewedSale();
    const pointer = JSON.parse(stored() ?? "null");
    expect(pointer).toMatchObject({ saleRef: saleA.saleRef });
    // The in-lock pre-send read is complete; the follow-up read claims a bare draft.
    failStatusAfterPreRead(() => json({ saleRef: saleA.saleRef, paymentState: "draft", status: "draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to Reader" }));
    await screen.findByText(/Payment outcome not confirmed. Do not charge again; use Refresh Status./);
    await screen.findByText(/sale status was incomplete/);
    expectLockedForRecovery(pointer);
    expect(requestsTo("/api/payments/stripe-terminal")).toHaveLength(1);

    delete server.override["/api/payments/stripe-terminal/status"];
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    await screen.findByRole("button", { name: "Send Same Payment Again" });
    expect(screen.getByText(/Waiting for the card on the reader/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to Reader" })).toBeNull();
  });

  it("keeps a contended sale withdrawn when the lock-held read is malformed, then shows the complete paid outcome", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("closed");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const startNew = await screen.findByRole("button", { name: "Start New Sale" });
    heldLocks.add("skyla:pos-register-sale");
    fireEvent.click(startNew);
    await screen.findByText(/Another register tab is working on this sale/);
    heldLocks.clear();

    server.override["/api/payments/stripe-terminal/status"] = () => json({ ...usablePaid(), paymentState: "closed", ticketIssued: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    await screen.findByText(/sale status was incomplete/);
    expectLockedForRecovery();

    delete server.override["/api/payments/stripe-terminal/status"];
    server.sale = usablePaid();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    await screen.findByText(/Paid. Booking SALE261002-AAAAAA has an issued ticket for Sat, Oct 3, entry from 2:00 PM through closing, no re-entry./);
    expect(screen.getByRole("link", { name: "Open admission ticket" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start New Sale" })).toBeTruthy();
  });
});

describe("paid wording follows ticket evidence", () => {
  const paid = (extra: Partial<SaleOutcome>): SaleOutcome => ({
    saleRef: saleA.saleRef,
    paymentState: "paid",
    visitDate: "2026-10-03",
    entryTime: "14:00",
    party: { total: 2 },
    bookingRef: "SKY-1",
    ...extra
  });

  it("states used, cancelled, expired, unconfirmed and cafe-only outcomes plainly", () => {
    const today = "2026-10-02";
    const issued = { ticketIssued: true, admissionUsed: false, bookingStatus: "confirmed" };
    expect(ticketStanding(paid(issued), today)).toBe("usable");
    expect(saleStatusMessage(paid({ ...issued, admissionUsed: true, bookingStatus: "checked-in" }), today)).toBe(
      "Paid. Booking SKY-1 was already used for entry. No re-entry."
    );
    expect(saleStatusMessage(paid({ ...issued, bookingStatus: "cancelled" }), today)).toMatch(/is cancelled, so its ticket cannot be used/);
    expect(saleStatusMessage(paid(issued), "2026-10-04")).toMatch(/has passed, so its ticket cannot be used/);
    expect(saleStatusMessage(paid({}), today)).toMatch(/ticket for booking SKY-1 is not confirmed; check it before admitting/);
    expect(saleStatusMessage(paid({ visitDate: undefined, entryTime: undefined, party: undefined }), today)).toBe("Paid. Receipt is ready.");
    for (const message of [paid({}), paid({ ...issued, admissionUsed: true })].map((status) => saleStatusMessage(status, today))) {
      expect(message).not.toMatch(/ready for admission/);
    }
    expect(saleStatusMessage({ ...paid({ ticketIssued: true }), paymentState: "paid_needs_attention" }, today)).toMatch(
      /A ticket exists for booking SKY-1, but do not admit on it/
    );
    expect(saleStatusMessage({ ...paid({}), paymentState: "paid_needs_attention" }, today)).not.toMatch(/No ticket was issued/);
  });

  it("checks payment state first and never lets missing delivery erase recorded entry", () => {
    const today = "2026-10-02";
    const issued = { ticketIssued: true, admissionUsed: false, bookingStatus: "confirmed" };
    for (const paymentState of ["unknown", "awaiting_payment", "starting", "paid_needs_attention", "refunded"] as const) {
      expect(ticketStanding({ ...paid(issued), paymentState }, today)).toBe("unconfirmed");
    }
    // Entry evidence stands even with delivery absent or false, in any state.
    expect(ticketStanding(paid({ admissionUsed: true, ticketIssued: false }), today)).toBe("used");
    expect(ticketStanding(paid({ bookingStatus: "checked-in" }), today)).toBe("used");
    expect(ticketStanding({ ...paid({ admissionUsed: true }), paymentState: "refunded" }, today)).toBe("used");
    expect(saleStatusMessage(paid({ admissionUsed: true, ticketIssued: false }), today)).toBe(
      "Paid. Booking SKY-1 was already used for entry. No re-entry."
    );
    expect(saleStatusMessage({ ...paid({ ...issued, admissionUsed: true }), paymentState: "paid_needs_attention" }, today)).toMatch(
      /Do not charge again. Admission was already used for entry. No re-entry./
    );
    expect(saleStatusMessage({ ...paid({ admissionUsed: true }), paymentState: "refunded" }, today)).toBe(
      "This sale was paid and then refunded. Admission was already used for entry. No re-entry."
    );
    // A future ticket is for its selected date and entry window, not "now".
    expect(saleStatusMessage(paid(issued), today)).toBe(
      "Paid. Booking SKY-1 has an issued ticket for Sat, Oct 3, entry from 2:00 PM through closing, no re-entry."
    );
  });

  it("renders the pure outcome with a ticket link only for financially paid, usable evidence", () => {
    const ticket = { ticketCode: "tkt_0123456789abcdef0123456789abcdef" };
    const issued = { ...ticket, ticketIssued: true, admissionUsed: false, bookingStatus: "confirmed" };
    const withTotal = (status: SaleOutcome) => ({ ...status, totalCents: 3000 });
    const link = () => screen.queryByRole("link", { name: "Open admission ticket" });

    render(<PosSaleOutcome status={withTotal(paid(issued))} today="2026-10-02" message="Paid." attention={false} />);
    expect(link()?.getAttribute("href")).toBe("/tickets/tkt_0123456789abcdef0123456789abcdef");
    cleanup();

    for (const status of [
      { ...paid(issued), paymentState: "paid_needs_attention" as const },
      { ...paid(issued), paymentState: "unknown" as const },
      paid({ ...issued, admissionUsed: true }),
      paid({ ...ticket, admissionUsed: true, ticketIssued: false })
    ]) {
      render(<PosSaleOutcome status={withTotal(status)} today="2026-10-02" message="" attention />);
      expect(link()).toBeNull();
      cleanup();
    }
  });

  it("offers the admission ticket link only for an unused confirmed ticket", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify(saleA));
    server.sale = saleStatus("paid", {
      bookingRef: saleA.saleRef,
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      bookingStatus: "checked-in",
      ticketIssued: true,
      admissionUsed: true
    });
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    await screen.findByText(/was already used for entry. No re-entry./);
    expect(screen.getByText("Paid total")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open admission ticket" })).toBeNull();
  });
});

describe("recovery helper contracts", () => {
  it("stores only into an empty slot and clears only the same sale", () => {
    expect(storeActiveSale(saleA)).toBe("stored");
    expect(storeActiveSale(saleB)).toBe("occupied");
    expect(clearActiveSale(saleB)).toBe("different_sale");
    expect(JSON.parse(stored() ?? "null")).toEqual(saleA);
    expect(clearActiveSale(saleA)).toBe("cleared");
    expect(clearActiveSale(saleA)).toBe("already_empty");
  });

  it("does not queue work behind a held lock and reports a rejecting lock manager as unavailable", async () => {
    const work = vi.fn(async () => "ran");
    heldLocks.add("skyla:pos-register-sale");
    await expect(withRegisterLock(work)).resolves.toEqual({ status: "busy" });
    heldLocks.clear();
    await expect(withRegisterLock(work)).resolves.toEqual({ status: "held", value: "ran" });
    await expect(withRegisterLock(async () => Promise.reject(new Error("inner")))).rejects.toThrow("inner");
    Object.defineProperty(window.navigator, "locks", {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException("insecure", "SecurityError")) }
    });
    await expect(withRegisterLock(work)).resolves.toEqual({ status: "unavailable" });
    expect(work).toHaveBeenCalledTimes(1);
  });
});
