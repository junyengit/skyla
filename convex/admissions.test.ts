import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryCtx } from "./_generated/server";
import * as admin from "./admin";
import * as admissions from "./admissions";
import * as ticketDelivery from "./ticketDelivery";
import { createConvexHarness, type ConvexHarness } from "./convexHarness.testkit";
import { buildCheckoutDraftWrite } from "./lib/orderDraftPersistence";
import { loadDateOccupancy, loadVenueHours } from "./lib/capacity";

const noon = Date.parse("2026-10-02T19:00:00Z");
let sequence = 0;
function setup() {
  const h = createConvexHarness({ admin, admissions, ticketDelivery });
  for (const role of ["admin", "pos", "viewer"]) h.seed("staffUsers", { subject: role, emailLower: `${role}@example.com`, active: true, role });
  return h;
}
function paidBooking(h: ConvexHarness, counts: { adults?: number; children?: number; freeChildren?: number } = {}) {
  const ref = `SKY-DOOR-${++sequence}`;
  const built = buildCheckoutDraftWrite({ packageKey: "general", adults: 1, ...counts, visitDate: "2026-10-02", entryTime: "10:00", idempotencyKey: `door_fixture_${sequence}` }, { orderRef: ref, now: noon - 3600000 });
  h.seed("orders", { ...built.order, status: "paid" });
  built.lines.forEach(line => h.seed("orderLineItems", line));
  const bookingId = h.seed("bookings", { bookingRef: ref, orderRef: ref, visitDate: "2026-10-02", entryTime: "10:00", partySize: built.draft.lines.filter(line => line.kind === "ticket").reduce((sum, line) => sum + line.quantity, 0), status: "confirmed", createdAt: noon - 3600000 });
  h.seed("paymentEvents", { orderRef: ref, provider: "stripe", providerPaymentId: `cs_test_door${sequence}`, providerPaymentIntentId: `pi_door${sequence}`, status: "paid", currency: "usd", amountCents: built.order.totalCents, createdAt: noon - 3600000 });
  return { ref, bookingId };
}
const admit = (h: ConvexHarness, ref: string, as: string | null = "pos") => h.call<{ admissionOutcome: string; checkedInAt: number }>(admin.updateBookingStatus, { bookingRef: ref, status: "checked-in" }, as ?? undefined);
const depart = (h: ConvexHarness, ref: string, departedCount: number, as: string | null = "pos") => h.call<{ outcome: string; remainingInside: number }>(admissions.recordDeparture, { bookingRef: ref, departedCount }, as ?? undefined);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(noon); });
afterEach(() => vi.useRealTimers());

describe("atomic, paid, single-use admission", () => {
  it("admits the whole age-counted party after the old 30-minute grace and records immutable redemption", async () => {
    const h = setup(); const { ref } = paidBooking(h, { children: 1, freeChildren: 2 });
    const first = await admit(h, ref);
    expect(first.admissionOutcome).toBe("admitted");
    expect(h.rows("bookingAdmissions")[0]).toMatchObject({ partySize: 4, departedCount: 0, inside: true, admittedAt: noon });
    expect(h.rows("auditEvents").filter(row => row.action === "admission.redeemed")).toHaveLength(1);
    expect((await admit(h, ref)).admissionOutcome).toBe("already_admitted");
    await expect(h.call(admin.updateBookingStatus, { bookingRef: ref, status: "confirmed" }, "admin")).rejects.toThrow("cannot be undone");
    await depart(h, ref, 4);
    expect((await admit(h, ref)).admissionOutcome).toBe("already_admitted");
    expect(h.rows("bookings")[0]!.checkedInAt).toBe(noon);
    expect(h.rows("bookingAdmissions")).toHaveLength(1);
  });
  it.each([null, "viewer"])("denies admission and departure to %s", async role => {
    const h = setup(); const { ref } = paidBooking(h);
    await expect(admit(h, ref, role)).rejects.toThrow(/Staff/);
    await admit(h, ref);
    await expect(depart(h, ref, 1, role)).rejects.toThrow(/Staff/);
  });
  it("serializes concurrent scans and the last two places including free children", async () => {
    const h = setup(); const full = paidBooking(h, { freeChildren: 27 });
    const a = paidBooking(h, { children: 1 }); const b = paidBooking(h, { children: 1 });
    const scans = await Promise.all([admit(h, full.ref), admit(h, full.ref)]);
    expect(scans.map(row => row.admissionOutcome).sort()).toEqual(["admitted", "already_admitted"]);
    const race = await Promise.allSettled([admit(h, a.ref), admit(h, b.ref)]);
    expect(race.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(race.filter(row => row.status === "rejected")).toHaveLength(1);
    expect(await h.call(admissions.getOccupancy, {}, "viewer")).toMatchObject({ insideCount: 30, remaining: 0, verified: true });
  });
  it.each([
    ["2026-10-02T16:30:00Z", "before entry"],
    ["2026-10-03T01:00:00Z", "at closing"],
    ["2026-10-03T17:00:00Z", "next LA date"],
    ["2026-10-02T06:00:00Z", "previous LA date despite UTC date"]
  ])("rejects %s (%s) without redemption", async timestamp => {
    const h = setup(); const { ref } = paidBooking(h); vi.setSystemTime(new Date(timestamp));
    await expect(admit(h, ref)).rejects.toThrow("selected entry time");
    expect(h.rows("bookingAdmissions")).toHaveLength(0);
  });
  it("uses the configured Sunday closing time across November DST", async () => {
    const h = setup(); const { ref, bookingId } = paidBooking(h);
    await h.ctx.db.patch(bookingId, { visitDate: "2026-11-01" });
    await h.ctx.db.patch(h.rows("orders")[0]!._id, { visitDate: "2026-11-01" });
    vi.setSystemTime(new Date("2026-11-01T18:30:00Z"));
    expect((await admit(h, ref)).admissionOutcome).toBe("admitted");
  });
  it.each(["unpaid", "missing_money", "mismatched_money", "corrupt_lines", "wrong_party", "fully_refunded", "billing_exception", "private_event"])("fails closed for %s", async corruption => {
    const h = setup(); const { ref, bookingId } = paidBooking(h);
    if (corruption === "unpaid") await h.ctx.db.patch(h.rows("orders")[0]!._id, { status: "payment_pending" });
    if (corruption === "missing_money") h.rows("paymentEvents").length = 0;
    if (corruption === "mismatched_money") await h.ctx.db.patch(h.rows("paymentEvents")[0]!._id, { amountCents: 1 });
    if (corruption === "corrupt_lines") await h.ctx.db.patch(h.rows("orderLineItems")[0]!._id, { unitAmountCents: 1 });
    if (corruption === "wrong_party") await h.ctx.db.patch(bookingId, { partySize: 2 });
    if (corruption === "fully_refunded") h.seed("refunds", { providerRefundId: `re_full_${ref}`, providerPaymentIntentId: h.rows("paymentEvents")[0]!.providerPaymentIntentId, paymentProvider: "stripe", orderRef: ref, currency: "usd", status: "succeeded", amountCents: 2000 });
    if (corruption === "billing_exception") h.seed("operationsExceptions", { orderRef: ref, category: "billing", status: "open" });
    if (corruption === "private_event") h.seed("privateEvents", { visitDate: "2026-10-02", status: "confirmed" });
    await expect(admit(h, ref)).rejects.toThrow("Admission blocked:");
    expect(h.rows("bookingAdmissions")).toHaveLength(0);
  });
  it("keeps the existing partial-refund entitlement policy", async () => {
    const h = setup(); const { ref } = paidBooking(h);
    h.seed("refunds", { providerRefundId: `re_partial_${ref}`, providerPaymentIntentId: h.rows("paymentEvents")[0]!.providerPaymentIntentId, paymentProvider: "stripe", orderRef: ref, currency: "usd", status: "succeeded", amountCents: 1000 });
    expect((await admit(h, ref)).admissionOutcome).toBe("admitted");
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects corrupt stored quantities %s before computing the party or paid total", async quantity => {
    const h = setup(); const { ref, bookingId } = paidBooking(h, { adults: 2, children: 1 });
    const youth = h.rows("orderLineItems").find(line => (line.metadata as { ageCategory?: string }).ageCategory === "youth")!;
    await h.ctx.db.patch(youth._id, { quantity, lineTotalCents: quantity * 1000 });
    await h.ctx.db.patch(h.rows("orders")[0]!._id, { totalCents: 4000 + quantity * 1000 });
    await h.ctx.db.patch(h.rows("paymentEvents")[0]!._id, { amountCents: 4000 + quantity * 1000 });
    await h.ctx.db.patch(bookingId, { partySize: 2 });
    await expect(admit(h, ref)).rejects.toThrow("reconciliation");
    expect(h.rows("bookingAdmissions")).toHaveLength(0);
  });
  it("accepts an opaque QR lookup, but never resurrects a redeemed public ticket after status restoration", async () => {
    const h = setup(); const { ref, bookingId } = paidBooking(h);
    const ticketCode = `tkt_${sequence.toString(16).padStart(32, "0")}`;
    h.seed("ticketDeliveries", { ticketCode, bookingRef: ref, orderRef: ref, status: "suppressed", attemptCount: 0, sendVersion: 1, createdAt: noon, updatedAt: noon });
    expect(await h.call(ticketDelivery.getTicket, { ticketCode })).toMatchObject({ status: "confirmed", partySize: 1 });
    expect(await h.call(admin.lookupBookingForCheckIn, { query: `https://skydeckla.com/tickets/${ticketCode}` }, "pos")).toMatchObject({ matchType: "ticketCode", matches: [{ bookingRef: ref }] });
    await admit(h, ref); await depart(h, ref, 1);
    await h.ctx.db.patch(bookingId, { status: "confirmed", checkedInAt: undefined });
    expect(await h.call(ticketDelivery.getTicket, { ticketCode })).toMatchObject({ status: "checked-in" });
    expect((await admit(h, ref)).admissionOutcome).toBe("already_admitted");
  });
  it("expires public ticket display by the Los Angeles closing time and withholds unpaid QR eligibility", async () => {
    const h = setup(); const { ref } = paidBooking(h);
    const ticketCode = `tkt_${sequence.toString(16).padStart(32, "0")}`;
    h.seed("ticketDeliveries", { ticketCode, bookingRef: ref, orderRef: ref, status: "suppressed", attemptCount: 0, sendVersion: 1, createdAt: noon, updatedAt: noon });
    vi.setSystemTime(new Date("2026-10-03T01:00:00Z"));
    expect(await h.call(ticketDelivery.getTicket, { ticketCode })).toMatchObject({ status: "expired" });
    await h.ctx.db.patch(h.rows("orders")[0]!._id, { status: "payment_pending" });
    expect(await h.call(ticketDelivery.getTicket, { ticketCode })).toMatchObject({ status: "needs-attention" });
  });
});

describe("physical departure independent of billing", () => {
  it("keeps completed history outside the physical admission hot query", async () => {
    const h = setup();
    for (let index = 0; index < 501; index++) {
      const ref = `COMPLETED-${index}`;
      h.seed("bookings", { bookingRef: ref, visitDate: "2026-10-01", status: "checked-in", checkedInAt: noon - 86400000, admissionTracked: true, createdAt: noon - 86400000 });
      h.seed("bookingAdmissions", { bookingRef: ref, visitDate: "2026-10-01", partySize: 1, departedCount: 1, inside: false, admittedAt: noon - 86400000, departedAt: noon - 80000000, updatedAt: noon - 80000000 });
    }
    expect(await h.call(admissions.getOccupancy, {}, "viewer")).toMatchObject({ verified: true, insideCount: 0, remaining: 30 });
    const { ref } = paidBooking(h);
    expect((await admit(h, ref)).admissionOutcome).toBe("admitted");
  });
  it("keeps high same-day turnover and cancelled history outside date capacity reads", async () => {
    const h = setup();
    for (let index = 0; index < 540; index++) {
      const ref = `TURNOVER-${index}`;
      h.seed("bookings", { bookingRef: ref, orderRef: ref, visitDate: "2026-10-02", entryTime: "09:00", partySize: 1, status: "checked-in", checkedInAt: noon - 3600000, admissionTracked: true, departedAt: noon - 1800000, createdAt: noon - 3600000 });
      h.seed("bookingAdmissions", { bookingRef: ref, visitDate: "2026-10-02", partySize: 1, departedCount: 1, inside: false, admittedAt: noon - 3600000, departedAt: noon - 1800000, updatedAt: noon - 1800000 });
      h.seed("capacityReservations", { orderRef: ref, visitDate: "2026-10-02", entryTime: "09:00", startMinutes: 540, endMinutes: 1080, partySize: 1, status: "paid", departedCount: 1, departedAt: noon - 1800000 });
    }
    for (let index = 0; index < 600; index++) {
      h.seed("bookings", { bookingRef: `CANCELLED-${index}`, visitDate: "2026-10-02", status: "cancelled", createdAt: noon - 3600000 });
      h.seed("capacityReservations", { orderRef: `RELEASED-${index}`, visitDate: "2026-10-02", entryTime: "09:00", startMinutes: 540, endMinutes: 1080, partySize: 1, status: "released" });
    }
    const date = await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", await loadVenueHours(h.ctx as unknown as QueryCtx));
    expect(date).toEqual({ privateEvent: false, intervals: [] });
    const { ref } = paidBooking(h);
    expect((await admit(h, ref)).admissionOutcome).toBe("admitted");
    h.seed("bookings", { bookingRef: "UNKNOWN", visitDate: "2026-10-02", status: "completed", createdAt: noon });
    expect(await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", await loadVenueHours(h.ctx as unknown as QueryCtx))).toMatchObject({ unverifiedReason: "unknown_booking_status" });
  });
  it("uses cumulative counts so partial, repeated and stale departures never double-release or allow re-entry", async () => {
    const h = setup(); const { ref } = paidBooking(h, { freeChildren: 3 }); await admit(h, ref);
    expect(await depart(h, ref, 2)).toMatchObject({ outcome: "recorded", remainingInside: 2 });
    expect(await depart(h, ref, 2)).toMatchObject({ outcome: "already_recorded", remainingInside: 2 });
    expect(await depart(h, ref, 1)).toMatchObject({ outcome: "already_recorded", remainingInside: 2 });
    expect(await h.call(admissions.getOccupancy, {}, "viewer")).toMatchObject({ insideCount: 2 });
    await depart(h, ref, 4);
    expect(await h.call(admissions.getOccupancy, {}, "admin")).toMatchObject({ insideCount: 0 });
    expect((await admit(h, ref)).admissionOutcome).toBe("already_admitted");
    expect(h.rows("auditEvents").filter(row => row.action === "admission.departureRecorded")).toHaveLength(2);
  });
  it.each([-1, 0, 1.5, 5])("rejects invalid departed count %s", async count => {
    const h = setup(); const { ref } = paidBooking(h, { freeChildren: 3 }); await admit(h, ref);
    await expect(depart(h, ref, count)).rejects.toThrow("departedCount must be");
    expect(h.rows("bookingAdmissions")[0]!.departedCount).toBe(0);
  });
  it("preserves still-inside counts after cancellation, refund and midnight", async () => {
    const h = setup(); const { ref } = paidBooking(h, { children: 1 }); await admit(h, ref);
    await h.call(admin.updateBookingStatus, { bookingRef: ref, status: "cancelled" }, "admin");
    await h.ctx.db.patch(h.rows("orders")[0]!._id, { status: "canceled" });
    vi.setSystemTime(new Date("2026-10-03T18:00:00Z"));
    expect(await h.call(admissions.getOccupancy, {}, "pos")).toMatchObject({ insideCount: 2 });
    const forecast = await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-03", await loadVenueHours(h.ctx as unknown as QueryCtx));
    expect(forecast.intervals.reduce((sum, row) => sum + row.partySize, 0)).toBe(2);
    await depart(h, ref, 2);
    expect(await h.call(admissions.getOccupancy, {}, "pos")).toMatchObject({ insideCount: 0 });
    expect(h.rows("bookings")[0]!.status).toBe("cancelled");
  });
  it("does not guess the occupancy or departure of old checked-in records", async () => {
    const h = setup(); const { ref } = paidBooking(h);
    h.seed("bookings", { bookingRef: "OLD", status: "cancelled", checkedInAt: noon - 86400000, createdAt: noon - 86400000 });
    await expect(admit(h, ref)).rejects.toThrow("reconciliation");
    expect(await h.call(admissions.getOccupancy, {}, "viewer")).toMatchObject({ verified: false, remaining: 0 });
    await expect(depart(h, "OLD", 1)).rejects.toThrow("legacy departure");
  });
  it("reduces the held forecast only after physical departure", async () => {
    const h = setup(); const { ref } = paidBooking(h, { freeChildren: 3 });
    h.seed("capacityReservations", { orderRef: ref, visitDate: "2026-10-02", entryTime: "10:00", startMinutes: 600, endMinutes: 1080, partySize: 4, status: "paid" });
    await admit(h, ref); await depart(h, ref, 2);
    expect((await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", await loadVenueHours(h.ctx as unknown as QueryCtx))).intervals[0]!.partySize).toBe(2);
    await depart(h, ref, 4);
    expect((await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", await loadVenueHours(h.ctx as unknown as QueryCtx))).intervals).toHaveLength(0);
    expect(h.rows("capacityReservations")[0]!.status).toBe("paid");
  });
  it("counts a cancelled inside party once despite its retained paid hold and closing break", async () => {
    const h = setup(); const { ref } = paidBooking(h, { children: 1 });
    h.seed("capacityReservations", { orderRef: ref, visitDate: "2026-10-02", entryTime: "10:00", startMinutes: 600, endMinutes: 720, partySize: 2, status: "paid" });
    await admit(h, ref);
    await h.call(admin.updateBookingStatus, { bookingRef: ref, status: "cancelled" }, "admin");
    const hours = await loadVenueHours(h.ctx as unknown as QueryCtx);
    const date = await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", hours);
    expect(date.intervals).toEqual([{ startMinutes: 0, endMinutes: 1440, partySize: 2 }]);
    await depart(h, ref, 1);
    expect((await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", hours)).intervals).toEqual([{ startMinutes: 0, endMinutes: 1440, partySize: 1 }]);
    await depart(h, ref, 2);
    expect((await loadDateOccupancy(h.ctx as unknown as QueryCtx, "2026-10-02", hours)).intervals).toEqual([]);
  });
});
