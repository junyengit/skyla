import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as admin from "./admin";
import * as admissions from "./admissions";
import { createConvexHarness } from "./convexHarness.testkit";
import * as paymentInternals from "./paymentInternals";

const admittedAt = Date.parse("2026-10-02T19:00:00Z");

function setup(provider: "stripe" | "terminal") {
  const harness = createConvexHarness({ admin, admissions, paymentInternals });
  const staffId = harness.seed("staffUsers", {
    subject: "admin", emailLower: "admin@example.com", role: "admin", active: true
  });
  const businessRef = `REFUND-ADMISSION-${provider}`;
  const paymentIntentId = `pi_refund_admission_${provider}`;
  const business = provider === "stripe" ? { orderRef: businessRef } : { saleRef: businessRef };
  const entityTable = provider === "stripe" ? "orders" : "posSales";
  harness.seed(entityTable, {
    ...business, status: "paid", expectedProvider: provider, totalCents: 4000,
    currency: "usd", createdAt: admittedAt - 1000, updatedAt: admittedAt - 1000
  });
  const bookingId = harness.seed("bookings", {
    ...business, bookingRef: businessRef, visitDate: "2026-10-02", entryTime: "10:00",
    partySize: 2, status: "checked-in", checkedInAt: admittedAt, admittedPartySize: 2,
    departedPartySize: 0, createdAt: admittedAt - 1000, updatedAt: admittedAt
  });
  harness.seed("bookingAdmissions", {
    bookingRef: businessRef, visitDate: "2026-10-02", partySize: 2, admittedAt,
    admittedBy: staffId, departedCount: 0, inside: true, updatedAt: admittedAt
  });
  harness.seed("paymentEvents", {
    ...business, provider, providerPaymentId: paymentIntentId,
    providerPaymentIntentId: paymentIntentId, status: "paid", amountCents: 4000,
    currency: "usd", createdAt: admittedAt - 1000
  });
  if (provider === "stripe") harness.seed("capacityReservations", {
    ...business, visitDate: "2026-10-02", entryTime: "10:00", startMinutes: 600,
    endMinutes: 1080, partySize: 2, status: "paid", createdAt: admittedAt - 1000,
    updatedAt: admittedAt - 1000
  });
  const refund = (status: "succeeded" | "failed") => harness.call(paymentInternals.recordStripeRefundWebhook, {
    providerEventId: `evt_refund_admission_${provider}_${status}`, eventType: "refund.updated",
    outcome: "refund", providerRefundId: `re_refund_admission_${provider}`,
    providerPaymentIntentId: paymentIntentId, refundStatus: status, amountCents: 4000,
    currency: "usd", providerEventCreatedAt: Date.now(), ...(status === "failed" ? { failureReason: "declined" } : {})
  });
  return { harness, businessRef, bookingId, entityTable, refund };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(admittedAt + 1000); });
afterEach(() => vi.useRealTimers());

describe.each(["stripe", "terminal"] as const)("%s refund cancellation ownership", provider => {
  it.each([1, 2])("restores refund-owned status after %i departures without restoring admission entitlement", async departedCount => {
    const t = setup(provider);
    await t.refund("succeeded");
    const invalidation = t.harness.rows("auditEvents").find(row => row.action === "payment.refund.fulfillmentInvalidated")!;
    expect(t.harness.rows("bookings")[0]!.refundCancellationOwner).toBe(invalidation._id);

    vi.advanceTimersByTime(1000);
    await t.harness.call(admissions.recordDeparture, { bookingRef: t.businessRef, departedCount }, "admin");
    expect(t.harness.rows("bookings")[0]!.updatedAt).not.toBe(invalidation.createdAt);
    expect(t.harness.rows("bookings")[0]!.refundCancellationOwner).toBe(invalidation._id);
    vi.advanceTimersByTime(1000);
    await t.refund("failed");

    expect(t.harness.rows(t.entityTable)[0]!.status).toBe("paid");
    expect(t.harness.rows("bookings")[0]).toMatchObject({
      status: "checked-in", checkedInAt: admittedAt, admittedPartySize: 2, departedPartySize: departedCount
    });
    expect(t.harness.rows("bookings")[0]!.refundCancellationOwner).toBeUndefined();
    expect(t.harness.rows("bookingAdmissions")[0]).toMatchObject({
      admittedAt, departedCount, inside: departedCount < 2
    });
    if (provider === "stripe") expect(t.harness.rows("capacityReservations")[0]!.departedCount).toBe(departedCount);
    expect(await t.harness.call(admin.updateBookingStatus, {
      bookingRef: t.businessRef, status: "checked-in"
    }, "admin")).toMatchObject({ admissionOutcome: "already_admitted" });
    expect(t.harness.rows("bookingAdmissions")).toHaveLength(1);
    expect(t.harness.rows("auditEvents").find(row => row.action === "payment.refund.fulfillmentRestored")!.metadata).toMatchObject({
      entityRestored: true, bookingRestored: true
    });
  });

  it("keeps a subsequent independent cancellation even when the status was already cancelled", async () => {
    const t = setup(provider);
    await t.refund("succeeded");
    vi.advanceTimersByTime(1000);
    await t.harness.call(admin.updateBookingStatus, {
      bookingRef: t.businessRef, status: "cancelled", note: "Owner cancellation independent of refund"
    }, "admin");
    expect(t.harness.rows("bookings")[0]!.refundCancellationOwner).toBeUndefined();
    expect(t.harness.rows("auditEvents").filter(row => row.action === "admin.bookingStatus.update")).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    await t.refund("failed");

    expect(t.harness.rows(t.entityTable)[0]!.status).toBe("paid");
    expect(t.harness.rows("bookings")[0]).toMatchObject({ status: "cancelled", checkedInAt: admittedAt });
    expect(t.harness.rows("bookingAdmissions")[0]).toMatchObject({ inside: true, departedCount: 0 });
    expect(t.harness.rows("auditEvents").find(row => row.action === "payment.refund.fulfillmentRestored")!.metadata).toMatchObject({
      entityRestored: true, bookingRestored: false
    });
  });

  it("does not infer legacy cancellation ownership from a coincidentally matching updatedAt", async () => {
    const t = setup(provider);
    await t.refund("succeeded");
    await t.harness.ctx.db.patch(t.bookingId, { refundCancellationOwner: undefined });
    vi.advanceTimersByTime(1000);
    await t.refund("failed");
    expect(t.harness.rows("bookings")[0]!.status).toBe("cancelled");
    expect(t.harness.rows("auditEvents").find(row => row.action === "payment.refund.fulfillmentRestored")!.metadata).toMatchObject({
      bookingRestored: false
    });
  });
});
