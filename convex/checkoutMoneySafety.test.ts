import { currentLiabilityWaiverVersion, currentTermsVersion } from "@skyla/payments";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as checkoutReconciliation from "./checkoutReconciliation";
import * as checkoutStatus from "./checkoutStatus";
import { createConvexHarness, createFakeStripe, type ConvexHarness } from "./convexHarness.testkit";
import { loadDateOccupancy, loadVenueHours, releaseUnpaidCapacityHold } from "./lib/capacity";
import { defaultHours } from "./lib/adminConfig";
import { buildCheckoutDraftWrite } from "./lib/orderDraftPersistence";
import * as operationsExceptions from "./operationsExceptions";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";
import * as ticketDelivery from "./ticketDelivery";

declare const process: { env: Record<string, string | undefined> };

// Friday 2026-10-02, 12:00 PM in Los Angeles; Saturday is open 10:00-22:00.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const visitDate = "2026-10-03";

type Row = Record<string, unknown> & { _id: string };
type Draft = { orderRef: string; idempotencyKey: string };

let sequence = 0;
const hexKey = () => (++sequence).toString(16).padStart(64, "0");

function setup() {
  const harness = createConvexHarness({
    orderDrafts,
    payments,
    paymentInternals,
    checkoutReconciliation,
    checkoutStatus,
    ticketDelivery,
    operationsExceptions
  });
  const stripe = createFakeStripe();
  vi.stubGlobal("fetch", vi.fn(stripe.fetch));
  return { harness, stripe };
}

async function createDraft(harness: ConvexHarness): Promise<Draft> {
  const idempotencyKey = `checkout_money_${String(++sequence).padStart(5, "0")}`;
  const draft = await harness.call<{ orderRef: string }>(orderDrafts.createCheckoutOrderDraft, {
    gatewayRateLimitKey: hexKey(),
    packageKey: "general",
    adults: 1,
    children: 1,
    visitDate,
    entryTime: "14:00",
    customerEmail: "guest@example.com",
    idempotencyKey
  });
  return { orderRef: draft.orderRef, idempotencyKey };
}

function startPayment(harness: ConvexHarness, draft: Draft) {
  return harness.runAction<{ checkoutSessionId: string }>(payments.createStripeCheckoutSession, {
    gatewayRateLimitKey: hexKey(),
    orderRef: draft.orderRef,
    idempotencyKey: draft.idempotencyKey,
    legalAcceptance: {
      termsAccepted: true,
      termsVersion: currentTermsVersion,
      liabilityWaiverAccepted: true,
      liabilityWaiverVersion: currentLiabilityWaiverVersion
    },
    successUrl: "https://skydeckla.com/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
  });
}

function paidWebhook(harness: ConvexHarness, attempt: Row) {
  return harness.call<{ status: string }>(paymentInternals.recordStripeCheckoutWebhook, {
    providerEventId: `evt_money_${++sequence}`,
    eventType: "checkout.session.completed",
    outcome: "paid",
    providerPaymentId: attempt.providerSessionId,
    providerPaymentIntentId: "pi_checkout_money_1",
    orderRef: attempt.orderRef,
    ticketCode: `tkt_${String(++sequence).padStart(32, "0")}`,
    amountCents: attempt.amountCents,
    currency: "usd",
    attemptNonce: attempt.attemptNonce,
    sessionMode: "payment",
    livemode: false,
    sessionStatus: "complete",
    paymentStatus: "paid",
    providerEventCreatedAt: Date.now()
  });
}

const attemptRow = (harness: ConvexHarness) => harness.rows("checkoutPaymentAttempts")[0] as Row;
const holdsFor = (harness: ConvexHarness, orderRef: string) =>
  harness.rows("capacityReservations").filter((row) => row.orderRef === orderRef);
const paidRows = (harness: ConvexHarness, orderRef: string) =>
  harness.rows("paymentEvents").filter((row) => row.orderRef === orderRef && row.status === "paid");
const openBilling = (harness: ConvexHarness, orderRef: string) =>
  harness.rows("operationsExceptions").filter((row) => row.orderRef === orderRef && row.status === "open" && row.category === "billing");
const removeOwnHold = (harness: ConvexHarness, orderRef: string) => {
  const list = harness.rows("capacityReservations");
  list.splice(list.findIndex((row) => row.orderRef === orderRef), 1);
};

const checkedIn = (harness: ConvexHarness, bookingRef: string, legacy: boolean) =>
  harness.seed("bookings", {
    bookingRef, orderRef: `ORD-${bookingRef}`, visitDate, entryTime: "10:00", partySize: 2, status: "checked-in",
    checkedInAt: fridayNoon - 3_600_000, ...(legacy ? {} : { admissionTracked: true }), createdAt: 1
  });
const admissionRow = (harness: ConvexHarness, bookingRef: string, departedCount: number) =>
  harness.seed("bookingAdmissions", {
    bookingRef, visitDate, partySize: 2, admittedAt: fridayNoon - 3_600_000, admittedBy: "staffUsers|seed-1",
    departedCount, inside: departedCount < 2, ...(departedCount === 2 ? { departedAt: fridayNoon - 60_000 } : {}), updatedAt: 1
  });

type Corruption = {
  label: string;
  corrupt: (harness: ConvexHarness, orderRef: string) => void;
  code: string;
  unverified: boolean;
  ambiguousHold?: boolean;
};

const corruptions: Corruption[] = [
  {
    label: "a duplicate hold for the order",
    corrupt: (harness, orderRef) => {
      const { _id: _ignored, _creationTime: _time, ...copy } = holdsFor(harness, orderRef)[0] as Row & { _creationTime: number };
      harness.seed("capacityReservations", { ...copy });
    },
    code: "paid_capacity_reservation_inconsistent",
    unverified: true,
    ambiguousHold: true
  },
  {
    label: "a dual-owner hold",
    corrupt: (harness, orderRef) => {
      holdsFor(harness, orderRef)[0].saleRef = "POS-DUAL-OWNER";
    },
    code: "paid_capacity_reservation_inconsistent",
    unverified: true,
    ambiguousHold: true
  },
  {
    label: "a duplicate booking for the order",
    corrupt: (harness, orderRef) => {
      for (let index = 0; index < 2; index += 1) {
        harness.seed("bookings", {
          bookingRef: orderRef, orderRef, visitDate, entryTime: "14:00", partySize: 2, status: "confirmed",
          emailLower: "guest@example.com", createdAt: 1
        });
      }
    },
    code: "paid_booking_duplicate",
    unverified: false
  },
  {
    // With no own hold, settlement reads the shared date ledger.
    label: "a duplicated admission ledger for an older check-in",
    corrupt: (harness, orderRef) => {
      removeOwnHold(harness, orderRef);
      checkedIn(harness, "SKY-LEGACY-DUP", true);
      admissionRow(harness, "SKY-LEGACY-DUP", 0);
      admissionRow(harness, "SKY-LEGACY-DUP", 2);
    },
    code: "paid_order_capacity_exception",
    unverified: true
  },
  {
    label: "a duplicated booking for an admitted party",
    corrupt: (harness, orderRef) => {
      removeOwnHold(harness, orderRef);
      checkedIn(harness, "SKY-BOOKING-DUP", false);
      checkedIn(harness, "SKY-BOOKING-DUP", false);
      admissionRow(harness, "SKY-BOOKING-DUP", 0);
    },
    code: "paid_order_capacity_exception",
    unverified: true
  },
  {
    label: "a malformed cumulative departure on an active hold",
    corrupt: (harness, orderRef) => {
      removeOwnHold(harness, orderRef);
      harness.seed("capacityReservations", {
        saleRef: "POS-BAD-DEPARTURE", visitDate, entryTime: "10:00", startMinutes: 600, endMinutes: 1320,
        partySize: 2, departedCount: 3, status: "paid", createdAt: 1, updatedAt: 1
      });
    },
    code: "paid_order_capacity_exception",
    unverified: true
  }
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_money_fixture");
  process.env.SKYLA_STRIPE_MODE = "test";
  process.env.SKYLA_PAYMENT_RETURN_ORIGINS = "https://skydeckla.com";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.SKYLA_STRIPE_MODE;
  delete process.env.SKYLA_PAYMENT_RETURN_ORIGINS;
});

describe("checkout paid money survives known ledger corruption", () => {
  it.each(corruptions)("resolves fully received money with $label as a held billing exception", async ({ corrupt, code, unverified, ambiguousHold }) => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    const session = await startPayment(harness, draft);
    corrupt(harness, draft.orderRef);
    const holdStatusesBefore = holdsFor(harness, draft.orderRef).map((row) => row.status);
    const seededBookings = harness.rows("bookings").filter((row) => row.orderRef === draft.orderRef).length;

    // The mutation resolves; a rejected one would roll the paid row back.
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });

    const order = harness.rows("orders").find((row) => row.orderRef === draft.orderRef)!;
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
    expect(openBilling(harness, draft.orderRef)).toEqual([
      expect.objectContaining({ code, moneyReceived: true, amountCents: order.totalCents })
    ]);
    expect(order.status).toBe("paid");
    expect(harness.rows("bookings").filter((row) => row.orderRef === draft.orderRef)).toHaveLength(seededBookings);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    const returned = await harness.call<Record<string, unknown>>(checkoutStatus.getCheckoutReturnStatus, {
      checkoutSessionId: session.checkoutSessionId
    });
    expect(returned.status).toBe("needs_attention");
    expect(returned).not.toHaveProperty("ticketCode");
    // Places stay held; nothing for this order is released. Ambiguous holds
    // are left exactly as stored and the release path refuses them.
    if (ambiguousHold) {
      expect(holdsFor(harness, draft.orderRef).map((row) => row.status)).toEqual(holdStatusesBefore);
      await expect(releaseUnpaidCapacityHold(harness.ctx as never, draft.orderRef, "test", Date.now())).rejects.toThrow();
    } else {
      expect(holdsFor(harness, draft.orderRef).every((row) => row.status === "exception" || row.status === "paid")).toBe(true);
    }
    expect(holdsFor(harness, draft.orderRef).some((row) => row.status === "released")).toBe(false);
    const date = await loadDateOccupancy(harness.ctx as never, visitDate, await loadVenueHours(harness.ctx as never));
    if (unverified) expect(date.unverifiedReason).toBeDefined();
    else expect(date.intervals.reduce((sum, interval) => sum + interval.partySize, 0)).toBeGreaterThanOrEqual(2);

    // Repeated provider facts are idempotent.
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
    expect(openBilling(harness, draft.orderRef)).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
  });

  it("never re-queues a ticket from a repeat while a later billing exception is open", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "processed" });
    expect(harness.rows("ticketDeliveries")).toHaveLength(1);
    harness.rows("ticketDeliveries").splice(0, 1);
    harness.seed("operationsExceptions", {
      orderRef: draft.orderRef, dedupeKey: "later:billing", category: "billing", code: "paid_after_order_closed",
      status: "open", moneyReceived: true, occurrenceCount: 1, firstSeenAt: 2, lastSeenAt: 2, createdAt: 2, updatedAt: 2
    });

    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
  });
});

describe("checkout repeated money cannot bypass canonical proof", () => {
  it.each(["duplicate_paid", "full_refund"] as const)("does not claim an online send after %s corrupts its proof", async kind => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "processed" });
    const paid = paidRows(harness, draft.orderRef)[0];
    const delivery = harness.rows("ticketDeliveries")[0];
    if (kind === "duplicate_paid") {
      const { _id: ignoredId, _creationTime: ignoredTime, ...copy } = paid;
      harness.seed("paymentEvents", copy);
    } else harness.seed("refunds", {
      providerRefundId: `re_online_send_${++sequence}`, providerPaymentIntentId: paid.providerPaymentIntentId,
      paymentProvider: "stripe", orderRef: draft.orderRef, status: "succeeded", amountCents: paid.amountCents,
      currency: "usd", providerEventCreatedAt: 1, rawEventId: `evt_online_send_${sequence}`, createdAt: 1, updatedAt: 1
    });
    const bookingBefore = structuredClone(harness.rows("bookings")[0]);
    const scheduledBefore = harness.scheduled.length;
    await expect(harness.call(ticketDelivery.claimTicketDelivery, { deliveryId: delivery._id })).resolves.toBeNull();
    expect(harness.rows("ticketDeliveries")).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")[0]).toMatchObject({ status: "suppressed", attemptCount: 0 });
    expect(harness.rows("ticketDeliveries")[0].providerMessageId).toBeUndefined();
    expect(harness.rows("bookings")[0]).toEqual(bookingBefore);
    expect(harness.rows("bookingAdmissions")).toHaveLength(0);
    expect(harness.scheduled).toHaveLength(scheduledBefore);
    expect(paidRows(harness, draft.orderRef)).toHaveLength(kind === "duplicate_paid" ? 2 : 1);
    expect(holdsFor(harness, draft.orderRef)[0].status).toBe("paid");
  });

  it.each([1, 101])("never re-queues after %i other paid receipts appear", async count => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "processed" });
    const originalMoney = paidRows(harness, draft.orderRef)[0];
    harness.rows("ticketDeliveries").splice(0);
    const scheduledBefore = harness.scheduled.length;
    for (let index = 0; index < count; index++) harness.seed("paymentEvents", {
      orderRef: draft.orderRef, provider: "stripe", providerPaymentId: `cs_extra_${index}`,
      providerPaymentIntentId: `pi_extra_${index}`, status: "paid", amountCents: originalMoney.amountCents,
      currency: "usd", createdAt: 1
    });
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(harness, draft.orderRef)).toHaveLength(count + 1);
    expect(paidRows(harness, draft.orderRef)[0]).toEqual(originalMoney);
    expect(openBilling(harness, draft.orderRef)).toEqual([
      expect.objectContaining({ code: "paid_owner_payment_ambiguous", moneyReceived: true })
    ]);
    expect(harness.rows("bookings")).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(harness.scheduled).toHaveLength(scheduledBefore);
    expect(holdsFor(harness, draft.orderRef).some(row => row.status === "released")).toBe(false);
  });

  it("never re-queues a confirmed-looking booking when its sole paid record has a foreign pending claimant", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    await paidWebhook(harness, attemptRow(harness));
    harness.rows("ticketDeliveries").splice(0);
    harness.seed("paymentEvents", {
      orderRef: "ORD-FOREIGN", provider: "stripe", providerPaymentId: "cs_foreign",
      providerPaymentIntentId: "pi_checkout_money_1", status: "processing", amountCents: 3000,
      currency: "usd", createdAt: 1
    });
    const scheduledBefore = harness.scheduled.length;
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
    expect(openBilling(harness, draft.orderRef)).toHaveLength(1);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(harness.scheduled).toHaveLength(scheduledBefore);
  });
});

describe("checkout untrusted hours retain money and block new entitlement", () => {
  it.each(["duplicate", "malformed"] as const)("classifies %s stored hours without rolling back money", async kind => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    harness.seed("config", { key: "hours", data: kind === "malformed" ? { fri: { open: "broken" } } : defaultHours });
    if (kind === "duplicate") harness.seed("config", { key: "hours", data: defaultHours });
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
    expect(openBilling(harness, draft.orderRef)).toEqual([
      expect.objectContaining({ code: "paid_venue_hours_unverified", moneyReceived: true })
    ]);
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(harness.rows("bookingAdmissions")).toHaveLength(0);
    expect(holdsFor(harness, draft.orderRef)[0].status).toBe("exception");
    const orderCount = harness.rows("orders").length;
    await expect(createDraft(harness)).rejects.toThrow("Stored venue hours need reconciliation");
    expect(harness.rows("orders")).toHaveLength(orderCount);
  });
});

describe("checkout held places still require current conservative shared evidence", () => {
  it.each(["invalid_other_departure", "duplicate_physical_admission", "private_event", "capacity_full"] as const)("retains payment without a ticket after %s appears while payment is pending", async kind => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    // Keep the valid own hold: the safety check must not depend on its absence.
    if (kind === "invalid_other_departure") harness.seed("capacityReservations", {
      saleRef: "POS-CORRUPT-OTHER", visitDate, entryTime: "10:00", startMinutes: 600, endMinutes: 1320,
      partySize: 2, departedCount: 3, status: "paid", createdAt: 1, updatedAt: 1
    });
    else if (kind === "duplicate_physical_admission") {
      checkedIn(harness, "SKY-DUP-WHILE-PENDING", false);
      admissionRow(harness, "SKY-DUP-WHILE-PENDING", 0);
      admissionRow(harness, "SKY-DUP-WHILE-PENDING", 2);
    }
    else if (kind === "private_event") harness.seed("privateEvents", {
      eventRef: "EVENT-WHILE-PENDING", visitDate, status: "confirmed", createdAt: 1, updatedAt: 1
    });
    else harness.seed("capacityReservations", {
      saleRef: "POS-FULL-WHILE-PENDING", visitDate, entryTime: "10:00", startMinutes: 600, endMinutes: 1320,
      partySize: 30, status: "paid", createdAt: 1, updatedAt: 1
    });
    const bookingsBefore = harness.rows("bookings").length;
    await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(harness, draft.orderRef)).toHaveLength(1);
    expect(openBilling(harness, draft.orderRef)).toEqual([
      expect.objectContaining({ code: "paid_order_capacity_exception", moneyReceived: true })
    ]);
    expect(harness.rows("bookings")).toHaveLength(bookingsBefore);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdsFor(harness, draft.orderRef)[0].status).toBe("exception");
  });
});

describe("checkout paid evidence beyond every read bound", () => {
  const intentPaid = (harness: ConvexHarness) =>
    harness.rows("paymentEvents").filter((row) => row.providerPaymentIntentId === "pi_checkout_money_1" && row.status === "paid");

  it("retains the current payment exactly once after 101 earlier paid receipts, and repeats never append", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    const session = await startPayment(harness, draft);
    const order = harness.rows("orders").find((row) => row.orderRef === draft.orderRef)!;
    for (let index = 0; index < 101; index += 1) {
      harness.seed("paymentEvents", {
        orderRef: draft.orderRef, provider: "stripe", providerPaymentId: `cs_test_earlier_${index}`,
        providerPaymentIntentId: `pi_earlier_${index}`, status: "paid", currency: "usd", amountCents: order.totalCents, createdAt: 1
      });
    }

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(harness)).toEqual([expect.objectContaining({ orderRef: draft.orderRef })]);
      expect(openBilling(harness, draft.orderRef)).toEqual([
        expect.objectContaining({ code: "duplicate_payment_for_order", moneyReceived: true })
      ]);
      expect(harness.rows("bookings")).toHaveLength(0);
      expect(harness.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(harness, draft.orderRef).map((row) => row.status)).toEqual(["exception"]);
    }
    expect(paidRows(harness, draft.orderRef)).toHaveLength(102);
    const returned = await harness.call<Record<string, unknown>>(checkoutStatus.getCheckoutReturnStatus, {
      checkoutSessionId: session.checkoutSessionId
    });
    expect(returned).toEqual({ orderRef: draft.orderRef, status: "needs_attention" });
  });

  async function expectHeldException(harness: ConvexHarness, orderRef: string, sessionId: string, code: string) {
    expect(openBilling(harness, orderRef)).toEqual([expect.objectContaining({ code, moneyReceived: true })]);
    expect(harness.rows("bookings")).toHaveLength(0);
    expect(harness.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdsFor(harness, orderRef).map((row) => row.status)).toEqual(["exception"]);
    const returned = await harness.call<Record<string, unknown>>(checkoutStatus.getCheckoutReturnStatus, { checkoutSessionId: sessionId });
    expect(returned).not.toHaveProperty("ticketCode");
    expect(returned.status).not.toBe("confirmed");
  }

  it.each([
    ["amount", { amountCents: 1 }, "paid_payment_record_mismatch"],
    ["currency", { currency: "eur" }, "paid_payment_record_mismatch"],
    ["provider payment id", { providerPaymentId: "cs_test_some_other_session" }, "paid_payment_identity_reused"]
  ])("keeps a stored same-intent record with the wrong %s as stored and resolves the confirmed facts as an exception", async (_label, corruption, code) => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    const attempt = attemptRow(harness);
    const order = harness.rows("orders").find((row) => row.orderRef === draft.orderRef)!;
    harness.seed("paymentEvents", {
      orderRef: draft.orderRef, provider: "stripe", providerPaymentId: attempt.providerSessionId, providerPaymentIntentId: "pi_checkout_money_1",
      status: "paid", currency: "usd", amountCents: order.totalCents, createdAt: 1, ...corruption
    });
    const stored = structuredClone(intentPaid(harness));

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(harness)).toEqual(stored);
      await expectHeldException(harness, draft.orderRef, attempt.providerSessionId as string, code);
    }
  });

  it("finds a legacy paid Session row without an intent id after 101 other paid receipts, and never appends a second record", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    const attempt = attemptRow(harness);
    const sessionId = attempt.providerSessionId as string;
    const order = harness.rows("orders").find((row) => row.orderRef === draft.orderRef)!;
    for (let index = 0; index < 101; index += 1) {
      harness.seed("paymentEvents", {
        orderRef: draft.orderRef, provider: "stripe", providerPaymentId: `cs_test_earlier_${index}`,
        providerPaymentIntentId: `pi_earlier_${index}`, status: "paid", currency: "usd", amountCents: order.totalCents, createdAt: 1
      });
    }
    harness.seed("paymentEvents", {
      orderRef: draft.orderRef, provider: "stripe", providerPaymentId: sessionId, status: "paid", currency: "usd",
      amountCents: order.totalCents, createdAt: 2
    });
    const sessionPaid = () => harness.rows("paymentEvents").filter((row) => row.providerPaymentId === sessionId && row.status === "paid");

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(sessionPaid()).toHaveLength(1);
      expect(sessionPaid()[0]).not.toHaveProperty("providerPaymentIntentId");
      expect(paidRows(harness, draft.orderRef)).toHaveLength(102);
      await expectHeldException(harness, draft.orderRef, sessionId, "paid_payment_identity_conflict");
    }
  });

  it("blocks reuse when a foreign pending Terminal row for the intent sits beyond the old prefix", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    const attempt = attemptRow(harness);
    const sessionId = attempt.providerSessionId as string;
    for (let index = 0; index < 150; index += 1) {
      harness.seed("paymentEvents", {
        orderRef: draft.orderRef, provider: "stripe", providerPaymentId: sessionId, providerPaymentIntentId: "pi_checkout_money_1",
        status: "failed", currency: "usd", amountCents: 3000, createdAt: 1
      });
    }
    harness.seed("paymentEvents", {
      saleRef: "POS-FOREIGN-PENDING", provider: "terminal", providerPaymentId: "pi_checkout_money_1", providerPaymentIntentId: "pi_checkout_money_1",
      status: "requires_payment", currency: "usd", amountCents: 3000, createdAt: 2
    });

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(harness)).toHaveLength(0);
      await expectHeldException(harness, draft.orderRef, sessionId, "paid_payment_identity_reused");
    }
  });

  it("retains confirmed money exactly once when more than 500 same-status rows make ownership unverifiable", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    const attempt = attemptRow(harness);
    const sessionId = attempt.providerSessionId as string;
    for (let index = 0; index < 501; index += 1) {
      harness.seed("paymentEvents", {
        orderRef: draft.orderRef, provider: "stripe", providerPaymentId: sessionId, providerPaymentIntentId: "pi_checkout_money_1",
        status: "failed", currency: "usd", amountCents: 3000, createdAt: 1
      });
    }

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(harness)).toEqual([expect.objectContaining({ orderRef: draft.orderRef, providerPaymentId: sessionId })]);
      await expectHeldException(harness, draft.orderRef, sessionId, "paid_payment_identity_unverified");
    }
  });

  it("keeps another owner's paid record of the same intent as the only ledger row", async () => {
    const { harness } = setup();
    const draft = await createDraft(harness);
    await startPayment(harness, draft);
    harness.seed("paymentEvents", {
      orderRef: "SKY-OTHER-OWNER", provider: "stripe", providerPaymentId: "cs_test_other_owner", providerPaymentIntentId: "pi_checkout_money_1",
      status: "paid", currency: "usd", amountCents: 3000, createdAt: 1
    });

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(paidWebhook(harness, attemptRow(harness))).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(harness)).toEqual([expect.objectContaining({ orderRef: "SKY-OTHER-OWNER" })]);
      expect(openBilling(harness, draft.orderRef)).toEqual([
        expect.objectContaining({ code: "paid_payment_identity_reused", moneyReceived: true })
      ]);
      expect(harness.rows("bookings")).toHaveLength(0);
      expect(harness.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(harness, draft.orderRef).some((row) => row.status === "released")).toBe(false);
    }
  });
});

describe("checkout status stays at needs_attention past resolved history", () => {
  it("finds the 51st open billing exception and withholds confirmation and the ticket code", async () => {
    const { harness } = setup();
    const orderRef = `SKY-STATUS-${++sequence}`;
    const idempotencyKey = `checkout_status_${sequence}_key`;
    const built = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, visitDate, entryTime: "14:00", idempotencyKey },
      { orderRef, now: fridayNoon - 60_000 }
    );
    harness.seed("orders", { ...built.order, status: "paid", expectedProvider: "stripe" });
    built.lines.forEach((line) => harness.seed("orderLineItems", line));
    harness.seed("bookings", { bookingRef: orderRef, orderRef, visitDate, entryTime: "14:00", partySize: 1, status: "confirmed", createdAt: 1 });
    harness.seed("paymentEvents", {
      orderRef, provider: "stripe", providerPaymentId: "cs_test_status_aaaaaaaaaaaa", providerPaymentIntentId: "pi_status",
      status: "paid", currency: "usd", amountCents: built.order.totalCents, createdAt: 2
    });
    harness.seed("ticketDeliveries", {
      ticketCode: `tkt_${String(++sequence).padStart(32, "0")}`, bookingRef: orderRef, orderRef, status: "sent",
      attemptCount: 1, sendVersion: 1, createdAt: 1, updatedAt: 1
    });
    const status = () => harness.call<Record<string, unknown>>(checkoutStatus.getCheckoutAttemptStatus, { orderRef, idempotencyKey });
    expect(await status()).toMatchObject({ status: "confirmed", ticketCode: expect.any(String) });

    for (let index = 0; index < 50; index += 1) {
      harness.seed("operationsExceptions", {
        orderRef, dedupeKey: `history:${index}`, category: index % 2 ? "billing" : "checkout_attempt", code: "old",
        status: index % 2 ? "resolved" : "open", moneyReceived: false, occurrenceCount: 1, firstSeenAt: 1, lastSeenAt: 1,
        createdAt: 1, updatedAt: 1
      });
    }
    expect(await status()).toMatchObject({ status: "confirmed" });
    harness.seed("operationsExceptions", {
      orderRef, dedupeKey: "open:billing", category: "billing", code: "duplicate_payment_for_order", status: "open",
      moneyReceived: true, occurrenceCount: 1, firstSeenAt: 2, lastSeenAt: 2, createdAt: 2, updatedAt: 2
    });
    const blocked = await status();
    expect(blocked.status).toBe("needs_attention");
    expect(blocked).not.toHaveProperty("ticketCode");
    expect(blocked).not.toHaveProperty("bookingRef");
  });
});
