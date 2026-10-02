// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const staffFetch = vi.hoisted(() => vi.fn());
vi.mock("@/components/staff-auth-provider", () => ({
  useStaffSession: () => ({ status: "signed-in", email: "admin@example.com", staffFetch, signOut: vi.fn() })
}));
import { AdminOpsClient } from "./components/admin-ops-client";

const staff = { emailLower: "admin@example.com", role: "admin" };
const booking = { bookingRef: "BOOK-RECOVERY", status: "confirmed", partySize: 4, createdAt: 1 };
const hours = Object.fromEntries(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => [day, { open: "09:00", close: "18:00", closed: false }]));
const operations = {
  staff,
  readiness: {},
  counts: Object.fromEntries(["draftOrders", "pendingOrders", "draftPosSales", "pendingPosSales", "pendingMembers", "approvedMembers"].map(key => [key, { value: 0, capped: false }])),
  recent: { orders: [], posSales: [], paymentEvents: [], refunds: [], bookings: [booking], members: [] }
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let afterMutation: boolean;
let mutation: () => Promise<Response>;
let operationsResult: () => Promise<Response>;
let refreshedLookup: () => Promise<Response>;
let ticketDelivery: Record<string, unknown> | undefined;

beforeEach(() => {
  afterMutation = false;
  ticketDelivery = undefined;
  mutation = async () => json({ booking: { admissionOutcome: "admitted" } });
  operationsResult = async () => json(operations);
  refreshedLookup = async () => json({ staff, matches: [{ ...booking, status: "checked-in", checkedInAt: 1, admittedPartySize: 4, departedPartySize: 0 }] });
  staffFetch.mockReset();
  staffFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/admin/bookings/lookup?")) return afterMutation ? refreshedLookup() : json({ staff, matches: [{ ...booking, ...(ticketDelivery ? { ticketDelivery } : {}) }] });
    if (input === "/api/admin/bookings/status" && init?.method === "POST") { afterMutation = true; return mutation(); }
    if (input === "/api/admin/operations?limit=12") return operationsResult();
    if (input === "/api/admin/config") return json({ staff, config: { announcement: { active: false, text: "", type: "info" }, hours }, state: { announcement: { invalid: false }, hours: { invalid: false } }, editableKeys: [] });
    if (input === "/api/admin/catalog") return json({ activeVersion: null, versions: [], currentProducts: [] });
    if (input === "/api/admin/inquiries?limit=25") return json({ staff, inquiries: [] });
    throw new Error(`Unexpected staff request: ${input}`);
  });
});

describe("admin ticket delivery facts", () => {
  it.each([
    ["accepted", "Accepted by email provider; delivery unconfirmed."],
    ["sent", "Accepted by email provider; delivery unconfirmed."],
    ["bounced", "Email bounced. Contact details need review."],
    ["complained", "Email reported as spam."],
    ["failed", "Email delivery failed."],
    ["canceled", "Email delivery failed."],
    ["suppressed", "Email delivery suppressed."]
  ])("reports provider %s without claiming customer delivery", async (providerDeliveryStatus, label) => {
    ticketDelivery = { ticketCode: "tkt_0123456789abcdef0123456789abcdef", status: "sent", sentAt: 1000, attemptCount: 1, sendVersion: 1, providerDeliveryStatus };
    await findBooking();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/^Sent /)).toBeNull();
    expect(screen.queryByText(/^Delivered to recipient mail server/)).toBeNull();
  });
  it("shows mail-server confirmation separately from provider acceptance", async () => {
    ticketDelivery = { ticketCode: "tkt_0123456789abcdef0123456789abcdef", status: "sent", sentAt: 1000, attemptCount: 1, sendVersion: 1, providerDeliveryStatus: "delivered", deliveredAt: 2000 };
    await findBooking();
    expect(screen.getByText(/^Delivered to recipient mail server/)).toBeTruthy();
    expect(screen.queryByText(/delivery unconfirmed/)).toBeNull();
  });
});
afterEach(cleanup);

async function findBooking() {
  render(<AdminOpsClient catalog={[]} catalogState={{ version: "v1", source: "code", authority: "server", editableInAdmin: false }} />);
  fireEvent.change(screen.getByPlaceholderText("SKY2607-ABC123"), { target: { value: booking.bookingRef } });
  fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
  await screen.findByRole("button", { name: "Admit party" });
}

describe("admin admission mutation recovery", () => {
  it("removes stale admission controls after an uncertain mutation response", async () => {
    mutation = async () => { throw new TypeError("Network response lost"); };
    await findBooking();
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText(/may have been recorded/);
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
    expect(screen.getByRole("button", { name: "Look Up" }).hasAttribute("disabled")).toBe(false);
  });

  it("preserves an operations refresh failure after acknowledged admission", async () => {
    operationsResult = async () => json({ error: "Operations temporarily unavailable" }, 503);
    await findBooking();
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText("Operations temporarily unavailable");
    await waitFor(() => expect(screen.queryByText("Party admitted. Record departure when people leave.")).toBeNull());
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
  });

  it("preserves a booking refresh failure without presenting stale admission", async () => {
    refreshedLookup = async () => json({ error: "Ticket lookup unavailable" }, 503);
    await findBooking();
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText("Ticket lookup unavailable");
    await waitFor(() => expect(screen.queryByText("Party admitted. Record departure when people leave.")).toBeNull());
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
  });

  it("ignores an old snapshot response received after an uncertain mutation", async () => {
    let resolveSnapshot!: (response: Response) => void;
    const pendingSnapshot = new Promise<Response>(resolve => { resolveSnapshot = resolve; });
    operationsResult = () => pendingSnapshot;
    mutation = async () => { throw new TypeError("Network response lost"); };
    await findBooking();
    fireEvent.click(screen.getByRole("button", { name: "Load Snapshot" }));
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText(/may have been recorded/);
    resolveSnapshot(json(operations));
    await waitFor(() => expect(screen.queryByText("Staff authorized")).toBeNull());
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
  });
});
