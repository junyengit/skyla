// @vitest-environment happy-dom
// Mocked staff fetch, server responses and an in-memory Web Locks stand-in
// prove register UI boundaries, not real Clerk authorization, a browser's
// lock manager or a Stripe payment.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { checkoutEntryTimes } from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ status: "signed-in", staffFetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/staff-auth-provider", () => ({ useStaffSession: () => ({ ...session, email: "register@skydeckla.com" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pos" }));

import { PosDraftClient } from "./components/pos-draft-client";

const storageKey = "skyla:pos-active-sale";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type ServerSale = Record<string, unknown> & { paymentState: string };
let server: { sale: ServerSale | null; released: boolean; requests: Array<{ url: string; body?: Record<string, unknown> }> };

function availability(url: string) {
  const params = new URL(url, "https://skydeckla.com").searchParams;
  return json({
    visitDate: params.get("date"),
    timeZone: "America/Los_Angeles",
    today: "2026-10-02",
    weekday: "Saturday",
    capacity: 30,
    partySize: Number(params.get("party")),
    dayStatus: "open",
    dayHours: { open: "10:00", close: "22:00", closed: false },
    slots: checkoutEntryTimes.map(({ value }) => ({ entryTime: value, status: value === "10:00" ? "full" : "available", remaining: 12 }))
  });
}

function saleStatus(paymentState: string, extra: Record<string, unknown> = {}): ServerSale {
  return {
    saleRef: "SALE261002-AAAAAA",
    status: paymentState === "draft" ? "draft" : paymentState.startsWith("paid") ? "paid" : "payment_pending",
    paymentState,
    currency: "usd",
    subtotalCents: 5000,
    feeCents: 0,
    totalCents: 5000,
    visitDate: "2026-10-03",
    entryTime: "14:00",
    party: { adults: 2, youths: 1, children: 2, total: 5 },
    lines: [],
    readerId: "tmr_front123",
    readerRetryAllowed: paymentState === "awaiting_payment",
    ticketIssued: false,
    admissionUsed: false,
    updatedAt: 1790000000000,
    ...extra
  };
}

function installLocks() {
  const held = new Set<string>();
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
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
  server = { sale: null, released: true, requests: [] };
  session.status = "signed-in";
  session.signOut.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/availability?")) return availability(String(url));
    throw new Error(`Unexpected public request: ${url}`);
  }));
  session.staffFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    server.requests.push({ url, body });
    if (url === "/api/pos/readers") {
      return json({ staff: { emailLower: "register@skydeckla.com", role: "pos" }, readers: [{ label: "Front", readerId: "tmr_front123" }] });
    }
    if (url === "/api/order-drafts/pos") {
      server.sale = saleStatus("draft");
      return json({
        persisted: true,
        saleRef: "SALE261002-AAAAAA",
        draft: { status: "draft", currency: "usd", subtotalCents: 5000, feeCents: 0, totalCents: 5000, visitDate: "2026-10-03", entryTime: "14:00", readerId: "tmr_front123", lines: [] }
      });
    }
    if (url === "/api/payments/stripe-terminal") {
      server.sale = saleStatus("awaiting_payment");
      return json({ saleRef: "SALE261002-AAAAAA", paymentIntentId: "pi_fake", status: "open" });
    }
    if (url === "/api/payments/stripe-terminal/process") return json({ status: "processing" });
    if (url === "/api/payments/stripe-terminal/status") return server.sale ? json(server.sale) : json({ error: "missing" }, 404);
    if (url === "/api/pos/sale-release") {
      if (server.released) server.sale = null;
      return json({ released: server.released, ...(server.released ? {} : { status: "payment_pending" }) });
    }
    throw new Error(`Unexpected staff request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window.navigator as { locks?: unknown }).locks;
});

async function reviewMixedParty() {
  render(<PosDraftClient cafeItems={[]} terminalAccepted />);
  fireEvent.click(screen.getByRole("button", { name: "Load Readers" }));
  await screen.findByText("1 authorized reader loaded.");
  for (const [label, times] of [["Adult 18+", 2], ["Youth 8–17", 1], ["Child 0–7", 2]] as const) {
    for (let index = 0; index < times; index += 1) fireEvent.click(screen.getByRole("button", { name: `One more ${label}` }));
  }
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-03" } });
  fireEvent.change(screen.getByLabelText("Entry time"), { target: { value: "14:00" } });
  await screen.findByText(/12 of 30 places open for 5 at 2:00 PM/);
  fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));
  await screen.findByRole("button", { name: "Send to Reader" });
}

describe("POS register visit section and payment lock", () => {
  it("moves catalog focus and selection with arrows, Home and End without sending a mutation", () => {
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const admission = screen.getByRole("tab", { name: "Admission" });
    const cafe = screen.getByRole("tab", { name: "Cafe" });
    const custom = screen.getByRole("tab", { name: "Custom" });
    admission.focus();

    fireEvent.keyDown(admission, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cafe);
    expect(cafe.getAttribute("aria-selected")).toBe("true");
    expect(cafe.tabIndex).toBe(0);
    expect(admission.tabIndex).toBe(-1);
    expect(custom.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel", { name: "Cafe" }).getAttribute("aria-labelledby")).toBe(cafe.id);

    fireEvent.keyDown(cafe, { key: "End" });
    expect(document.activeElement).toBe(custom);
    expect(screen.getByRole("tabpanel", { name: "Custom" }).getAttribute("aria-labelledby")).toBe(custom.id);
    fireEvent.keyDown(custom, { key: "ArrowRight" });
    expect(document.activeElement).toBe(admission);
    fireEvent.keyDown(admission, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(custom);
    fireEvent.keyDown(custom, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cafe);
    fireEvent.keyDown(cafe, { key: "Home" });
    expect(document.activeElement).toBe(admission);
    expect(admission.getAttribute("aria-selected")).toBe("true");
    expect(admission.tabIndex).toBe(0);
    expect(cafe.tabIndex).toBe(-1);
    expect(custom.tabIndex).toBe(-1);
    expect(server.requests).toEqual([]);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("preserves the selected visit, mixed-age party and cafe cart while keyboard tabs change", async () => {
    render(<PosDraftClient cafeItems={[{ key: "c1", name: "Single-Origin Pour Over", priceCents: 800, category: "coffee" }]} terminalAccepted />);
    for (const label of ["Adult 18+", "Youth 8–17", "Child 0–7"]) {
      fireEvent.click(screen.getByRole("button", { name: `One more ${label}` }));
    }
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("Entry time"), { target: { value: "14:00" } });
    await screen.findByText(/12 of 30 places open for 3 at 2:00 PM/);
    const cafe = screen.getByRole("tab", { name: "Cafe" });
    fireEvent.click(cafe);
    fireEvent.click(screen.getByRole("button", { name: /Single-Origin Pour Over/ }));
    const cart = screen.getByRole("complementary", { name: "POS cart" });
    const before = cart.textContent;
    expect(within(cart).getByText("1 adult, 1 youth, 1 child free")).toBeTruthy();
    expect(within(cart).getByText("$38.00")).toBeTruthy();
    cafe.focus();
    fireEvent.keyDown(cafe, { key: "ArrowRight" });
    const custom = screen.getByRole("tab", { name: "Custom" });
    expect(document.activeElement).toBe(custom);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Private draft" } });
    fireEvent.keyDown(custom, { key: "Home" });
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-03");
    expect((screen.getByLabelText("Entry time") as HTMLSelectElement).value).toBe("14:00");
    expect(cart.textContent).toBe(before);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Admission" }), { key: "End" });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Private draft");
    expect(server.requests).toEqual([]);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps every tab and panel association unique across register instances", () => {
    const first = render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const second = render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    const allIds: string[] = [];
    for (const instance of [first, second]) {
      const view = within(instance.container);
      for (const tab of view.getAllByRole("tab")) {
        const panelId = tab.getAttribute("aria-controls");
        expect(tab.id).not.toBe("");
        expect(panelId).toBeTruthy();
        const panel = document.getElementById(panelId!);
        expect(instance.container.contains(panel)).toBe(true);
        expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
        allIds.push(tab.id, panelId!);
      }
      expect(view.getAllByRole("tabpanel")).toHaveLength(1);
      expect(view.getAllByRole("tabpanel", { hidden: true })).toHaveLength(3);
    }
    expect(new Set(allIds).size).toBe(12);
    fireEvent.keyDown(within(first.container).getByRole("tab", { name: "Admission" }), { key: "End" });
    expect(within(first.container).getByRole("tab", { name: "Custom" }).getAttribute("aria-selected")).toBe("true");
    expect(within(second.container).getByRole("tab", { name: "Admission" }).getAttribute("aria-selected")).toBe("true");
    expect(server.requests).toEqual([]);
  });

  it("shows the mixed-age party, selected visit and exact total, and stores only the sale identity", async () => {
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-02");
    cleanup();

    await reviewMixedParty();

    const review = server.requests.find((request) => request.url === "/api/order-drafts/pos")!;
    expect(review.body).toMatchObject({
      admission: { packageKey: "general", adults: 2, children: 1, freeChildren: 2, visitDate: "2026-10-03", entryTime: "14:00" },
      lines: [],
      readerId: "tmr_front123"
    });
    expect(screen.getByText("Admission · 5 people")).toBeTruthy();
    expect(screen.getByText("2 adults, 1 youth, 2 children free")).toBeTruthy();
    expect(screen.getByText("Sat, Oct 3 · 2:00 PM")).toBeTruthy();
    expect(screen.getByText("$50.00")).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    expect(Object.keys(stored).sort()).toEqual(["idempotencyKey", "saleRef", "version"]);
    expect(JSON.stringify(stored)).not.toMatch(/@|Bearer|tkt_|5000/);
  });

  it("disables full slots and keeps cart edits locked once a sale is stored", async () => {
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);
    fireEvent.click(screen.getByRole("button", { name: "One more Adult 18+" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-03" } });
    const full = await screen.findByRole("option", { name: "10:00 AM — full" });
    expect(full.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("option", { name: "2:00 PM — 12 left" }).hasAttribute("disabled")).toBe(false);
    cleanup();

    await reviewMixedParty();
    expect(screen.getByRole("button", { name: "One more Adult 18+" }).hasAttribute("disabled")).toBe(true);
    expect((screen.getByLabelText("Date") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
  });

  it("starts payment once on a double click, then locks Clear Sale and new review behind Refresh Status", async () => {
    await reviewMixedParty();
    const send = screen.getByRole("button", { name: "Send to Reader" });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });

    await screen.findByText(/Waiting for the card on the reader/);
    expect(server.requests.filter((request) => request.url === "/api/payments/stripe-terminal")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Clear Sale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change Sale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start New Sale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send Same Payment Again" })).toBeTruthy();
  });

  it("returns to an unknown-outcome sale after a reload or staff change and asks Stripe only on Refresh Status", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, saleRef: "SALE261002-AAAAAA", idempotencyKey: "pos_restore_000001" }));
    server.sale = saleStatus("unknown");
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);

    await screen.findByText(/Payment outcome not confirmed. Do not charge again/);
    expect(screen.queryByRole("button", { name: "Clear Sale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start New Sale" })).toBeNull();
    const reads = server.requests.filter((request) => request.url === "/api/payments/stripe-terminal/status");
    expect(reads.every((request) => request.body?.refresh === false)).toBe(true);

    server.sale = saleStatus("paid", {
      bookingRef: "SALE261002-AAAAAA",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      bookingStatus: "confirmed",
      ticketIssued: true,
      admissionUsed: false
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    await screen.findByText(
      /Paid. Booking SALE261002-AAAAAA has an issued ticket for Sat, Oct 3, entry from 2:00 PM through closing, no re-entry./
    );
    expect(server.requests.at(-1)).toMatchObject({ body: { saleRef: "SALE261002-AAAAAA", refresh: true } });
    expect(screen.getByRole("link", { name: "Open admission ticket" }).getAttribute("href")).toBe(
      "/tickets/tkt_0123456789abcdef0123456789abcdef"
    );
  });

  it("changes a draft only through an audited server release", async () => {
    await reviewMixedParty();
    fireEvent.click(screen.getByRole("button", { name: "Change Sale" }));

    await screen.findByText("Sale reopened for changes and its places released.");
    expect(server.requests.at(-1)).toMatchObject({ url: "/api/pos/sale-release", body: { saleRef: "SALE261002-AAAAAA" } });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByRole("button", { name: "One more Adult 18+" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Review Sale" })).toBeTruthy();
  });

  it("keeps the sale locked when the server refuses the release", async () => {
    await reviewMixedParty();
    server.released = false;
    server.sale = saleStatus("awaiting_payment");
    fireEvent.click(screen.getByRole("button", { name: "Clear Sale" }));

    await screen.findByText(/already reached payment, so it stays locked/);
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Refresh Status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review Sale" })).toBeNull();
  });

  it("states paid-needs-help honestly and frees the register only after an outcome", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, saleRef: "SALE261002-AAAAAA", idempotencyKey: "pos_restore_000002" }));
    server.sale = saleStatus("paid_needs_attention", { ticketIssued: false, admissionUsed: false });
    render(<PosDraftClient cafeItems={[]} terminalAccepted />);

    await screen.findByText(/Paid, but it needs staff review. Do not charge again. No usable ticket is confirmed/);
    expect(screen.queryByRole("link", { name: "Open admission ticket" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start New Sale" }));
    await screen.findByRole("button", { name: "Review Sale" });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("never takes payment when the sale identity cannot be stored on this browser", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      render(<PosDraftClient cafeItems={[]} terminalAccepted />);
      fireEvent.click(screen.getByRole("button", { name: "Load Readers" }));
      await screen.findByText("1 authorized reader loaded.");
      fireEvent.click(screen.getByRole("button", { name: "One more Adult 18+" }));
      fireEvent.change(screen.getByLabelText("Entry time"), { target: { value: "14:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Review Sale" }));

      await screen.findByText(/could not save the sale for recovery/);
      expect(server.requests.some((request) => request.url === "/api/pos/sale-release")).toBe(true);
      expect(server.requests.some((request) => request.url === "/api/payments/stripe-terminal")).toBe(false);
      expect(screen.queryByRole("button", { name: "Send to Reader" })).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});
