import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminClient = readFileSync(join(import.meta.dirname, "components/admin-ops-client.tsx"), "utf8");

describe("admin ticket delivery UI", () => {
  it("shows the authoritative ticket and delivery status in booking lookup", () => {
    expect(adminClient).toContain("booking.ticketDelivery.status");
    expect(adminClient).toContain("booking.ticketDelivery.failureReason");
    expect(adminClient).toContain("`/tickets/${booking.ticketDelivery.ticketCode}`");
    expect(adminClient).toContain("Open Ticket");
  });

  it("allows only admins with a customer email to queue a resend", () => {
    expect(adminClient).toContain('bookingLookup.staff.role === "admin" && booking.emailLower');
    expect(adminClient).toContain('staffSession.staffFetch("/api/admin/bookings/ticket-delivery"');
    expect(adminClient).toContain("resendTicketConfirmation(booking.bookingRef)");
    expect(adminClient).toContain("Resend Email");
  });
});
