// @vitest-environment happy-dom
// Mocked staff fetch proves UI boundaries, not real Clerk authorization.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ status: "signed-in", staffFetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/staff-auth-provider", () => ({ useStaffSession: () => ({ ...session, email: "door@skydeckla.com" }) }));
import { AdmissionClient } from "./components/admission-client";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let role: "admin" | "pos" | "viewer";
let occupancy: { verified: boolean; insideCount: number; capacity: number; parties: Array<{ bookingRef: string; partySize: number; departedCount: number }> };
let booking: { bookingRef: string; status: string; partySize: number; admittedPartySize?: number; departedPartySize?: number };
let occupancyUnavailable: boolean;
beforeEach(() => {
  session.status = "signed-in"; role = "pos"; occupancyUnavailable = false;
  booking = { bookingRef: "BOOK-DOOR", status: "confirmed", partySize: 4 };
  occupancy = { verified: true, insideCount: 0, capacity: 30, parties: [] };
  session.signOut.mockReset().mockResolvedValue(undefined);
  session.staffFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/bookings/lookup?")) return json({ staff: { role }, matches: [booking] });
    if (url === "/api/admin/admission/occupancy") return occupancyUnavailable ? json({ error: "Occupancy service unavailable" }, 503) : json({ staff: { role }, ...occupancy });
    if (url === "/api/admin/admission/departure" && init?.method === "POST") return json({ outcome: "recorded" });
    if (url === "/api/admin/bookings/status" && init?.method === "POST") return json({ booking: { admissionOutcome: "admitted" } });
    throw new Error(`Unexpected staff request: ${url}`);
  });
});
afterEach(cleanup);
async function findTicket() {
  render(<AdmissionClient />);
  fireEvent.change(screen.getByLabelText("Ticket QR link, booking reference or email"), { target: { value: booking.bookingRef } });
  fireEvent.click(screen.getByRole("button", { name: "Find ticket" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Find ticket" }).hasAttribute("disabled")).toBe(false));
}
describe("admission desk readiness and staff controls", () => {
  it("blocks entry when occupancy cannot be verified", async () => {
    occupancyUnavailable = true; await findTicket();
    expect(screen.getByRole("button", { name: "Admit party" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Verify occupancy before admission.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    expect(session.staffFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("blocks a party that does not fit in the verified remaining places", async () => {
    occupancy.insideCount = 28; await findTicket();
    expect(screen.getByRole("button", { name: "Admit party" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Only 2 places are available inside for this party of 4.")).toBeTruthy();
  });
  it("blocks entry when known occupancy still needs reconciliation", async () => {
    occupancy.verified = false; await findTicket();
    expect(screen.getByRole("button", { name: "Admit party" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Admission is blocked until occupancy is reconciled.")).toBeTruthy();
  });
  it("allows entry only after the whole party fits in verified occupancy", async () => {
    occupancy.insideCount = 26; await findTicket();
    expect(screen.getByRole("button", { name: "Admit party" }).hasAttribute("disabled")).toBe(false);
  });
  it("keeps audited departure available while overall occupancy needs reconciliation", async () => {
    occupancy.verified = false;
    booking = { ...booking, status: "checked-in", admittedPartySize: 4, departedPartySize: 1 };
    await findTicket();
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
    expect(screen.getByRole("button", { name: "1 person left" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "1 person left" }));
    await screen.findByText("Departure recorded. No re-entry.");
    expect(session.staffFetch).toHaveBeenCalledWith("/api/admin/admission/departure", expect.objectContaining({ body: JSON.stringify({ bookingRef: "BOOK-DOOR", departedCount: 2 }) }));
  });
  it("shows viewer identity and denies every mutation control", async () => {
    role = "viewer"; await findTicket();
    expect(screen.getByText("viewer staff")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
    expect(screen.queryByRole("button", { name: "1 person left" })).toBeNull();
  });
  it("shows the account identity and calls existing provider sign-out", async () => {
    render(<AdmissionClient />);
    expect(screen.getByText("door@skydeckla.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(session.signOut).toHaveBeenCalledTimes(1));
  });
  it("keeps the busy guard until every post-mutation read settles", async () => {
    let lookupCalls = 0; let occupancyCalls = 0;
    let resolveOccupancy!: (response: Response) => void;
    const pendingOccupancy = new Promise<Response>(resolve => { resolveOccupancy = resolve; });
    session.staffFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/admin/bookings/lookup?")) return ++lookupCalls === 1 ? json({ staff: { role }, matches: [booking] }) : json({ error: "Ticket refresh unavailable" }, 503);
      if (url === "/api/admin/admission/occupancy") return ++occupancyCalls === 1 ? json({ staff: { role }, ...occupancy }) : pendingOccupancy;
      if (url === "/api/admin/bookings/status") return json({ booking: { admissionOutcome: "admitted" } });
      throw new Error(`Unexpected request: ${url}`);
    });
    await findTicket();
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await waitFor(() => expect(occupancyCalls).toBe(2));
    expect(screen.getByRole("button", { name: "Find ticket" }).hasAttribute("disabled")).toBe(true);
    resolveOccupancy(json({ staff: { role }, ...occupancy }));
    await screen.findByText("Ticket refresh unavailable");
    expect(screen.getByRole("button", { name: "Find ticket" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
  });
  it("keeps controls closed when provider sign-in is unconfigured", () => {
    session.status = "unconfigured"; render(<AdmissionClient />);
    expect(screen.getByRole("button", { name: "Find ticket" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Refresh occupancy" }).hasAttribute("disabled")).toBe(true);
    expect(session.staffFetch).not.toHaveBeenCalled();
  });
  it("clears physical-action controls and requires verification after a lost mutation response", async () => {
    await findTicket();
    session.staffFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText("The result could not be verified. Refresh occupancy and find this ticket before acting again.");
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
    expect(screen.getByText("Occupancy has not been verified.")).toBeTruthy();
    expect(session.staffFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("never reports physical admission from an unrecognized successful response", async () => {
    await findTicket();
    session.staffFetch.mockResolvedValueOnce(json({}));
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    await screen.findByText("The result could not be verified. Refresh occupancy and find this ticket before acting again.");
    expect(screen.queryByText("Party admitted. Record departures when people leave.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
  });
});
