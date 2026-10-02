import { describe, expect, it } from "vitest";
import * as admin from "./admin";
import { createConvexHarness } from "./convexHarness.testkit";
describe("staff booking delivery projection", () => {
  it("preserves provider delivery facts without exposing provider message identity", async () => {
    const h = createConvexHarness({ admin });
    h.seed("staffUsers", { subject: "door", emailLower: "door@example.com", active: true, role: "pos" });
    h.seed("bookings", { bookingRef: "BOOK-DELIVERY", status: "confirmed", createdAt: 1 });
    h.seed("ticketDeliveries", { bookingRef: "BOOK-DELIVERY", ticketCode: "tkt_0123456789abcdef0123456789abcdef", status: "sent", attemptCount: 1, sendVersion: 1, sentAt: 1000, providerDeliveryStatus: "bounced", providerStatusAt: 2000, deliveredAt: 1500, providerMessageId: "private-provider-id", createdAt: 1, updatedAt: 2000 });
    const result = await h.call<{ matches: Array<{ ticketDelivery: Record<string, unknown> }> }>(admin.lookupBookingForCheckIn, { query: "BOOK-DELIVERY" }, "door");
    expect(result.matches[0]!.ticketDelivery).toMatchObject({ status: "sent", providerDeliveryStatus: "bounced", providerStatusAt: 2000, deliveredAt: 1500 });
    expect(result.matches[0]!.ticketDelivery).not.toHaveProperty("providerMessageId");
  });
});
