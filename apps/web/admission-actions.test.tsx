// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdmissionActions } from "./components/admission-actions";
import { TicketQr } from "./components/ticket-qr";

afterEach(cleanup);
describe("staff single-use controls", () => {
  it("offers admission to an unused active party and prevents viewer actions", () => {
    const onAdmit = vi.fn();
    const props = { booking: { bookingRef: "TEST", status: "confirmed", partySize: 4 }, busy: false, onAdmit, onDepart: vi.fn() };
    const view = render(<AdmissionActions {...props} canMutate />);
    fireEvent.click(screen.getByRole("button", { name: "Admit party" })); expect(onAdmit).toHaveBeenCalledTimes(1);
    view.rerender(<AdmissionActions {...props} canMutate={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("records absolute departure counts instead of restoring admission", () => {
    const onDepart = vi.fn();
    render(<AdmissionActions booking={{ bookingRef: "TEST", status: "cancelled", checkedInAt: 1, admittedPartySize: 4, departedPartySize: 2 }} canMutate busy={false} onAdmit={vi.fn()} onDepart={onDepart} />);
    expect(screen.getByText("2 of 4 still inside. No re-entry.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Admit party" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 person left" }));
    fireEvent.click(screen.getByRole("button", { name: "Everyone left" }));
    expect(onDepart.mock.calls).toEqual([[3], [4]]);
  });
  it("offers no re-entry after full departure even if another process restores confirmed status", () => {
    render(<AdmissionActions booking={{ bookingRef: "TEST", status: "confirmed", admittedPartySize: 4, departedPartySize: 4 }} canMutate busy={false} onAdmit={vi.fn()} onDepart={vi.fn()} />);
    expect(screen.getByText("0 of 4 still inside. No re-entry.")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not guess legacy occupancy or offer an undo", () => {
    render(<AdmissionActions booking={{ bookingRef: "TEST", status: "checked-in", partySize: 4 }} canMutate busy={false} onAdmit={vi.fn()} onDepart={vi.fn()} />);
    expect(screen.getByText("Used ticket. Occupancy needs reconciliation.")).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
  });
  it("can block new entry without blocking an audited departure", () => {
    const onAdmit = vi.fn(); const onDepart = vi.fn();
    const props = { canMutate: true, canAdmit: false, busy: false, onAdmit, onDepart };
    const view = render(<AdmissionActions {...props} booking={{ bookingRef: "TEST", status: "confirmed", partySize: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Admit party" }));
    expect(onAdmit).not.toHaveBeenCalled();
    view.rerender(<AdmissionActions {...props} booking={{ bookingRef: "TEST", status: "checked-in", admittedPartySize: 4, departedPartySize: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "1 person left" }));
    expect(onDepart).toHaveBeenCalledWith(2);
  });
});
describe("phone QR failure recovery", () => {
  it("eagerly loads the QR and provides a booking-reference fallback on image failure", () => {
    render(<TicketQr ticketCode="tkt_0123456789abcdef0123456789abcdef" />);
    const qr = screen.getByRole("img"); expect(qr.getAttribute("loading")).toBe("eager");
    fireEvent.error(qr);
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.getByRole("status").textContent).toContain("Show your booking reference to staff");
  });
});
