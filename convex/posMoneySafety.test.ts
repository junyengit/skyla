import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConvexHarness, createFakeStripeTerminal, type ConvexHarness } from "./convexHarness.testkit";
import { assertBookingPaid } from "./lib/admission";
import { loadDateOccupancy, loadVenueHours, releaseUnpaidCapacityHold } from "./lib/capacity";
import { defaultHours } from "./lib/adminConfig";
import {
  hasOpenBillingExceptionForOrder,
  hasOpenBillingExceptionForSale,
  openBillingExceptionsForOrder,
  openBillingExceptionsForSale,
  openOperationsException,
  resolveOperationsException
} from "./lib/operationsExceptions";
import { buildCheckoutDraftWrite, buildPosSaleDraftWrite } from "./lib/orderDraftPersistence";
import { bookingAdmission, loadPhysicalOccupancy, lookupBookingAdmission } from "./lib/occupancy";
import { stripeTerminalIntentIdempotencyKey } from "./lib/stripeTerminal";
import * as operationsExceptions from "./operationsExceptions";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";
import * as posStatus from "./posStatus";
import * as terminalReconciliation from "./terminalReconciliation";
import * as ticketDelivery from "./ticketDelivery";

// Friday 2026-10-02, 12:00 PM in Los Angeles (open 09:00-18:00).
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const friday = "2026-10-02";

type Row = Record<string, unknown> & { _id: string };
type Sale = { saleRef: string; idempotencyKey: string; totalCents: number };

let sequence = 0;
const ticketCode = () => `tkt_${String(++sequence).padStart(32, "0")}`;

function setup() {
  const h = createConvexHarness({
    operationsExceptions,
    orderDrafts,
    paymentInternals,
    payments,
    posStatus,
    terminalReconciliation,
    ticketDelivery
  });
  for (const role of ["admin", "pos", "viewer"] as const) {
    h.seed("staffUsers", { subject: role, emailLower: `${role}@example.com`, role, active: true, createdAt: 1, updatedAt: 1 });
  }
  const stripe = createFakeStripeTerminal();
  vi.stubGlobal("fetch", vi.fn(stripe.fetch));
  return { h, stripe };
}

async function createSale(
  h: ConvexHarness,
  admission: Record<string, unknown> | null = {},
  lines: Array<Record<string, unknown>> = []
): Promise<Sale> {
  const idempotencyKey = `pos_money_${String(++sequence).padStart(6, "0")}`;
  const result = await h.call<{ saleRef: string; totals: { totalCents: number } }>(
    orderDrafts.createPosSaleDraft,
    {
      ...(admission === null
        ? {}
        : { admission: { packageKey: "general", adults: 2, visitDate: friday, entryTime: "12:30", ...admission } }),
      lines,
      customerEmail: "walkup@example.com",
      readerId: "tmr_front123",
      idempotencyKey
    },
    "pos"
  );
  return { saleRef: result.saleRef, idempotencyKey, totalCents: result.totals.totalCents };
}

const start = (h: ConvexHarness, sale: Sale) =>
  h.runAction<{ paymentIntentId: string }>(
    payments.createStripeTerminalPaymentIntent,
    { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey },
    "pos"
  );
const attemptFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("terminalPaymentAttempts").find((row) => row.saleRef === sale.saleRef) as Row;
const saleRow = (h: ConvexHarness, sale: Sale) => h.rows("posSales").find((row) => row.saleRef === sale.saleRef) as Row;
const holdsFor = (h: ConvexHarness, sale: Sale) => h.rows("capacityReservations").filter((row) => row.saleRef === sale.saleRef);
const paidRows = (h: ConvexHarness, sale: Sale) =>
  h.rows("paymentEvents").filter((row) => row.saleRef === sale.saleRef && row.status === "paid");
const openBilling = (h: ConvexHarness, sale: Sale) =>
  h.rows("operationsExceptions").filter((row) => row.saleRef === sale.saleRef && row.status === "open" && row.category === "billing");
const saleStatus = (h: ConvexHarness, sale: Sale) =>
  h.call<Record<string, unknown>>(posStatus.getPosSaleStatus, { saleRef: sale.saleRef }, "pos");

function terminalWebhook(h: ConvexHarness, attempt: Row, overrides: Record<string, unknown> = {}) {
  return h.call<{ status: string; duplicate: boolean }>(paymentInternals.recordStripeTerminalWebhook, {
    providerEventId: `evt_money_${++sequence}`,
    eventType: "payment_intent.succeeded",
    outcome: "paid",
    providerPaymentId: attempt.providerPaymentIntentId,
    saleRef: attempt.saleRef,
    ticketCode: ticketCode(),
    amountCents: attempt.amountCents,
    amountReceivedCents: attempt.amountCents,
    currency: "usd",
    attemptNonce: attempt.attemptNonce,
    intentSource: "convex-terminal",
    livemode: false,
    intentStatus: "succeeded",
    providerEventCreatedAt: Date.now(),
    ...overrides
  });
}

async function occupancy(h: ConvexHarness) {
  return loadDateOccupancy(h.ctx as never, friday, await loadVenueHours(h.ctx as never));
}

function seedDeclines(h: ConvexHarness, saleRef: string, intentId: string, count: number, amountCents: number) {
  for (let index = 0; index < count; index += 1) {
    h.seed("paymentEvents", {
      saleRef,
      provider: "terminal",
      providerPaymentId: intentId,
      providerPaymentIntentId: intentId,
      status: "failed",
      currency: "usd",
      amountCents,
      createdAt: 1
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_terminal_fixture");
  vi.stubEnv("SKYLA_STRIPE_MODE", "test");
  vi.stubEnv("SKYLA_POS_TERMINAL_ACCEPTANCE", "enabled");
  vi.stubEnv("SKYLA_TERMINAL_READER_REGISTRY", "tmr_front123@tml_front123");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Corruption = {
  label: string;
  corrupt: (h: ConvexHarness, sale: Sale) => void;
  code: string;
  unverified: boolean;
  ambiguousHold?: boolean;
};

const otherCheckedIn = (h: ConvexHarness, bookingRef: string, legacy: boolean) =>
  h.seed("bookings", {
    bookingRef,
    orderRef: `ORD-${bookingRef}`,
    visitDate: friday,
    entryTime: "10:00",
    partySize: 2,
    status: "checked-in",
    checkedInAt: fridayNoon - 3_600_000,
    ...(legacy ? {} : { admissionTracked: true }),
    createdAt: 1
  });
const admissionRow = (h: ConvexHarness, bookingRef: string, departedCount: number) =>
  h.seed("bookingAdmissions", {
    bookingRef,
    visitDate: friday,
    partySize: 2,
    admittedAt: fridayNoon - 3_600_000,
    admittedBy: "staffUsers|seed-1",
    departedCount,
    inside: departedCount < 2,
    ...(departedCount === 2 ? { departedAt: fridayNoon - 60_000 } : {}),
    updatedAt: 1
  });

const corruptions: Corruption[] = [
  {
    label: "a duplicate hold for the sale",
    corrupt: (h, sale) => {
      const [hold] = holdsFor(h, sale);
      const { _id: _ignored, _creationTime: _time, ...copy } = hold as Row & { _creationTime: number };
      h.seed("capacityReservations", { ...copy });
    },
    code: "paid_capacity_reservation_inconsistent",
    unverified: true,
    ambiguousHold: true
  },
  {
    label: "a dual-owner hold",
    corrupt: (h, sale) => {
      holdsFor(h, sale)[0].orderRef = "ORD-DUAL-OWNER";
    },
    code: "paid_capacity_reservation_inconsistent",
    unverified: true,
    ambiguousHold: true
  },
  {
    label: "a duplicate booking for the sale",
    corrupt: (h, sale) => {
      for (let index = 0; index < 2; index += 1) {
        h.seed("bookings", {
          bookingRef: sale.saleRef, saleRef: sale.saleRef, visitDate: friday, entryTime: "12:30",
          partySize: 2, status: "confirmed", emailLower: "walkup@example.com", createdAt: 1
        });
      }
    },
    code: "paid_booking_duplicate",
    unverified: false
  },
  {
    label: "a duplicated admission ledger for an older check-in",
    corrupt: (h) => {
      otherCheckedIn(h, "SKY-LEGACY-DUP", true);
      admissionRow(h, "SKY-LEGACY-DUP", 0);
      admissionRow(h, "SKY-LEGACY-DUP", 2);
    },
    code: "paid_sale_capacity_exception",
    unverified: true
  },
  {
    label: "two inside admissions for one admitted party",
    corrupt: (h) => {
      otherCheckedIn(h, "SKY-INSIDE-DUP", false);
      admissionRow(h, "SKY-INSIDE-DUP", 0);
      admissionRow(h, "SKY-INSIDE-DUP", 1);
    },
    code: "paid_sale_capacity_exception",
    unverified: true
  },
  {
    label: "a duplicated booking for an admitted party",
    corrupt: (h) => {
      otherCheckedIn(h, "SKY-BOOKING-DUP", false);
      otherCheckedIn(h, "SKY-BOOKING-DUP", false);
      admissionRow(h, "SKY-BOOKING-DUP", 0);
    },
    code: "paid_sale_capacity_exception",
    unverified: true
  },
  {
    label: "a malformed cumulative departure on an active hold",
    corrupt: (h) => {
      h.seed("capacityReservations", {
        orderRef: "ORD-BAD-DEPARTURE", visitDate: friday, entryTime: "10:00", startMinutes: 600, endMinutes: 1080,
        partySize: 2, departedCount: 5, status: "paid", createdAt: 1, updatedAt: 1
      });
    },
    code: "paid_sale_capacity_exception",
    unverified: true
  }
];

describe("POS paid money survives known ledger corruption", () => {
  it.each(corruptions)("resolves fully received money with $label as a held billing exception", async ({ corrupt, code, unverified, ambiguousHold }) => {
    const { h } = setup();
    const sale = await createSale(h, { adults: 1, children: 1 });
    await start(h, sale);
    corrupt(h, sale);
    const holdStatusesBefore = holdsFor(h, sale).map((row) => row.status);
    const seededBookings = h.rows("bookings").filter((row) => row.saleRef === sale.saleRef).length;

    // The mutation resolves; a rejected one would roll the paid row back.
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });

    expect(paidRows(h, sale)).toHaveLength(1);
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code, moneyReceived: true, amountCents: sale.totalCents })]);
    expect(saleRow(h, sale).status).toBe("paid");
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    // Settlement creates no booking of its own.
    expect(h.rows("bookings").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(seededBookings);
    expect((await saleStatus(h, sale)).ticketCode).toBeUndefined();
    // Places stay held: no hold for the sale is released. Ambiguous holds are
    // left exactly as stored and the release path refuses them.
    expect(holdsFor(h, sale).length).toBeGreaterThan(0);
    if (ambiguousHold) {
      expect(holdsFor(h, sale).map((row) => row.status)).toEqual(holdStatusesBefore);
      await expect(releaseUnpaidCapacityHold(h.ctx as never, { saleRef: sale.saleRef }, "test", Date.now())).rejects.toThrow();
    } else {
      expect(holdsFor(h, sale).every((row) => row.status === "exception" || row.status === "paid")).toBe(true);
    }
    expect(holdsFor(h, sale).some((row) => row.status === "released")).toBe(false);
    const date = await occupancy(h);
    if (unverified) expect(date.unverifiedReason).toBeDefined();
    else expect(date.intervals.reduce((sum, interval) => sum + interval.partySize, 0)).toBeGreaterThanOrEqual(2);

    // Repeated provider facts are idempotent.
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(h, sale)).toHaveLength(1);
    expect(openBilling(h, sale)).toHaveLength(1);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
  });
});

describe("POS payment ledger reads use indexed subsets", () => {
  it("records one paid row after more than 100 declines, and repeats never append another", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    seedDeclines(h, sale.saleRef, attempt.providerPaymentIntentId as string, 150, sale.totalCents);

    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "processed" });
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "processed" });

    expect(paidRows(h, sale)).toHaveLength(1);
    expect(h.rows("bookings").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(1);
    expect(h.rows("ticketDeliveries")).toHaveLength(1);
    expect(openBilling(h, sale)).toHaveLength(0);
  });

  it("finds a conflicting intent owner beyond the old 100-row prefix and keeps the received money visible", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    seedDeclines(h, sale.saleRef, intentId, 150, sale.totalCents);
    h.seed("paymentEvents", {
      orderRef: "ORD-OTHER-OWNER", provider: "stripe", providerPaymentId: "cs_test_other", providerPaymentIntentId: intentId,
      status: "failed", currency: "usd", amountCents: sale.totalCents, createdAt: 2
    });

    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    expect(openBilling(h, sale)).toEqual([
      expect.objectContaining({ code: "paid_payment_identity_reused", moneyReceived: true, providerPaymentIntentId: intentId })
    ]);
    expect(paidRows(h, sale)).toHaveLength(0);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdsFor(h, sale).every((row) => row.status !== "released")).toBe(true);
  });

  it("rejects an unpaid outcome once a paid row exists behind more than 100 declines", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    seedDeclines(h, sale.saleRef, attempt.providerPaymentIntentId as string, 120, sale.totalCents);
    h.seed("paymentEvents", {
      saleRef: sale.saleRef, provider: "terminal", providerPaymentId: attempt.providerPaymentIntentId,
      providerPaymentIntentId: attempt.providerPaymentIntentId, status: "paid", currency: "usd", amountCents: sale.totalCents, createdAt: 3
    });
    await terminalWebhook(h, attempt, { outcome: "canceled", eventType: "payment_intent.canceled", intentStatus: "canceled" });
    expect(saleRow(h, sale).status).not.toBe("canceled");
    expect(holdsFor(h, sale).every((row) => row.status !== "released")).toBe(true);
  });

  it("records a genuine second distinct payment as money plus one exception, keeping one booking", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    // An older sale without a frozen attempt, correlated by two stored intents.
    saleRow(h, sale).status = "payment_pending";
    holdsFor(h, sale)[0].status = "payment_pending";
    for (const intentId of ["pi_legacy_first", "pi_legacy_second"]) {
      h.seed("paymentEvents", {
        saleRef: sale.saleRef, provider: "terminal", providerPaymentId: intentId, providerPaymentIntentId: intentId,
        idempotencyKey: stripeTerminalIntentIdempotencyKey(sale.saleRef), status: "requires_payment",
        currency: "usd", amountCents: sale.totalCents, createdAt: 1
      });
    }
    const legacy = (intentId: string) =>
      ({ providerPaymentIntentId: intentId, saleRef: sale.saleRef, amountCents: sale.totalCents }) as unknown as Row;
    const facts = { attemptNonce: undefined, intentSource: undefined, livemode: undefined };

    await expect(terminalWebhook(h, legacy("pi_legacy_first"), facts)).resolves.toMatchObject({ status: "processed" });
    await expect(terminalWebhook(h, legacy("pi_legacy_second"), facts)).resolves.toMatchObject({ status: "failed" });
    await expect(terminalWebhook(h, legacy("pi_legacy_second"), facts)).resolves.toMatchObject({ status: "failed" });

    expect(paidRows(h, sale).map((row) => row.providerPaymentIntentId).sort()).toEqual(["pi_legacy_first", "pi_legacy_second"]);
    expect(h.rows("bookings").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(1);
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "duplicate_payment_for_sale", moneyReceived: true })]);
  });
});

describe("POS paid evidence beyond every read bound", () => {
  const paidRow = (saleRef: string, intentId: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
    saleRef, provider: "terminal", providerPaymentId: intentId, providerPaymentIntentId: intentId,
    status: "paid", currency: "usd", amountCents, createdAt: 1, ...extra
  });
  const intentPaid = (h: ConvexHarness, intentId: string) =>
    h.rows("paymentEvents").filter((row) => row.providerPaymentIntentId === intentId && row.status === "paid");

  async function expectRetained(h: ConvexHarness, sale: Sale, intentId: string, code: string) {
    expect(intentPaid(h, intentId).filter((row) => row.saleRef === sale.saleRef)).toHaveLength(1);
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code, moneyReceived: true })]);
    expect(saleRow(h, sale).status).toBe("paid");
    expect(h.rows("bookings").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdsFor(h, sale).map((row) => row.status)).toEqual(["exception"]);
    expect((await saleStatus(h, sale)).ticketCode).toBeUndefined();
  }

  it("retains the current payment exactly once after 101 earlier paid receipts, and repeats never append", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    for (let index = 0; index < 101; index += 1) h.seed("paymentEvents", paidRow(sale.saleRef, `pi_earlier_${index}`, sale.totalCents));
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;

    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    await expectRetained(h, sale, intentId, "duplicate_payment_for_sale");
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    await expectRetained(h, sale, intentId, "duplicate_payment_for_sale");
    expect(paidRows(h, sale)).toHaveLength(102);
  });

  it("retains money when more than 500 same-status rows make intent ownership unverifiable", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    seedDeclines(h, sale.saleRef, intentId, 501, sale.totalCents);

    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    await expectRetained(h, sale, intentId, "paid_payment_identity_unverified");
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    await expectRetained(h, sale, intentId, "paid_payment_identity_unverified");
  });

  it("keeps another owner's paid record of the same intent as the only ledger row", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    h.seed("paymentEvents", paidRow("POS-OTHER-OWNER", intentId, sale.totalCents));

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(h, intentId)).toEqual([expect.objectContaining({ saleRef: "POS-OTHER-OWNER" })]);
      expect(openBilling(h, sale)).toEqual([
        expect.objectContaining({ code: "paid_payment_identity_reused", moneyReceived: true, providerPaymentIntentId: intentId })
      ]);
      expect(h.rows("bookings")).toHaveLength(0);
      expect(h.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(h, sale).some((row) => row.status === "released")).toBe(false);
    }
  });

  it.each([
    ["amount", { amountCents: 1 }],
    ["currency", { currency: "eur" }],
    ["provider payment id", { providerPaymentId: "pi_some_other_payment" }]
  ])("keeps a stored same-intent record with the wrong %s as stored and resolves the confirmed facts as an exception", async (_label, corruption) => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    h.seed("paymentEvents", paidRow(sale.saleRef, intentId, sale.totalCents, corruption));
    const stored = structuredClone(intentPaid(h, intentId));

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(intentPaid(h, intentId)).toEqual(stored);
      expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "paid_payment_record_mismatch", moneyReceived: true })]);
      expect(saleRow(h, sale).status).toBe("paid");
      expect(h.rows("bookings")).toHaveLength(0);
      expect(h.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(h, sale).map((row) => row.status)).toEqual(["exception"]);
    }
  });

  it("finds a legacy paid row without an intent id after 101 other paid receipts, and never appends a second record", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    for (let index = 0; index < 101; index += 1) h.seed("paymentEvents", paidRow(sale.saleRef, `pi_earlier_${index}`, sale.totalCents));
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    h.seed("paymentEvents", {
      saleRef: sale.saleRef, provider: "terminal", providerPaymentId: intentId, status: "paid", currency: "usd",
      amountCents: sale.totalCents, createdAt: 2
    });
    const sameProviderId = () => h.rows("paymentEvents").filter((row) => row.providerPaymentId === intentId && row.status === "paid");

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(sameProviderId()).toHaveLength(1);
      expect(sameProviderId()[0]).not.toHaveProperty("providerPaymentIntentId");
      expect(paidRows(h, sale)).toHaveLength(102);
      expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "paid_payment_record_mismatch", moneyReceived: true })]);
      expect(h.rows("bookings")).toHaveLength(0);
      expect(h.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(h, sale).map((row) => row.status)).toEqual(["exception"]);
    }
  });

  it("never appends to a duplicated paid ledger for one intent", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    const intentId = attempt.providerPaymentIntentId as string;
    h.seed("paymentEvents", paidRow(sale.saleRef, intentId, sale.totalCents));
    h.seed("paymentEvents", paidRow(sale.saleRef, intentId, sale.totalCents));

    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    expect(intentPaid(h, intentId)).toHaveLength(2);
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "paid_payment_ledger_duplicate", moneyReceived: true })]);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdsFor(h, sale).map((row) => row.status)).toEqual(["exception"]);
  });
});

describe("POS repeat confirmation requires unambiguous owner money and canonical proof", () => {
  const extraPaid = (h: ConvexHarness, sale: Sale, count: number) => {
    for (let index = 0; index < count; index += 1) {
      h.seed("paymentEvents", {
        saleRef: sale.saleRef, provider: "terminal", providerPaymentId: `pi_extra_${index}`, providerPaymentIntentId: `pi_extra_${index}`,
        status: "paid", currency: "usd", amountCents: sale.totalCents, createdAt: 5
      });
    }
  };

  it.each([
    ["two other distinct paid rows", (h: ConvexHarness, sale: Sale) => extraPaid(h, sale, 2), "paid_owner_payment_ambiguous"],
    ["101 historical paid rows", (h: ConvexHarness, sale: Sale) => extraPaid(h, sale, 101), "paid_owner_payment_ambiguous"],
    ["a booking that fails canonical proof", (h: ConvexHarness, sale: Sale) => {
      h.rows("bookings").find((row) => row.saleRef === sale.saleRef)!.partySize = 9;
    }, "paid_booking_proof_invalid"]
  ])("a repeat with %s resolves as an exception and queues no new delivery", async (_label, corrupt, code) => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "processed" });
    // Remove the outbox row so any re-delivery would be visible as a new one.
    h.rows("ticketDeliveries").splice(0, h.rows("ticketDeliveries").length);
    corrupt(h, sale);
    const bookingBefore = structuredClone(h.rows("bookings").find((row) => row.saleRef === sale.saleRef));

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
      expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code, moneyReceived: true })]);
      expect(h.rows("ticketDeliveries")).toHaveLength(0);
      expect(h.rows("bookings").find((row) => row.saleRef === sale.saleRef)).toEqual(bookingBefore);
      expect(h.rows("paymentEvents").filter((row) => row.providerPaymentIntentId === attempt.providerPaymentIntentId && row.status === "paid")).toHaveLength(1);
    }
  });

  it("blocks a cafe-only repeat when the sale has another distinct paid record, without inventing a booking", async () => {
    const { h } = setup();
    const sale = await createSale(h, null, [{ kind: "cafe", itemKey: "b1", quantity: 1 }]);
    await start(h, sale);
    const attempt = attemptFor(h, sale);
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "processed" });
    extraPaid(h, sale, 2);
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "failed" });
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "paid_owner_payment_ambiguous" })]);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
  });
});

describe("POS settlement with untrusted venue hours", () => {
  it.each([
    ["duplicated", (h: ConvexHarness) => {
      h.seed("config", { key: "hours", data: structuredClone(defaultHours), updatedAt: 1 });
      h.seed("config", { key: "hours", data: structuredClone(defaultHours), updatedAt: 1 });
    }],
    ["malformed", (h: ConvexHarness) => h.seed("config", { key: "hours", data: { Funday: { open: "09:00" } }, updatedAt: 1 })]
  ])("resolves paid money with %s stored hours as a held exception, and new sales fail closed", async (_label, corruptHours) => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    otherCheckedIn(h, "SKY-INSIDE-HOURS", false);
    admissionRow(h, "SKY-INSIDE-HOURS", 0);
    corruptHours(h);

    for (let repeat = 0; repeat < 2; repeat += 1) {
      await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
      expect(paidRows(h, sale)).toHaveLength(1);
      expect(openBilling(h, sale)).toEqual([expect.objectContaining({ code: "paid_venue_hours_unverified", moneyReceived: true })]);
      expect(h.rows("bookings").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(0);
      expect(h.rows("ticketDeliveries")).toHaveLength(0);
      expect(holdsFor(h, sale).map((row) => row.status)).toEqual(["exception"]);
    }
    await expect(createSale(h)).rejects.toThrow("Stored venue hours need reconciliation");
    await expect(loadVenueHours(h.ctx as never)).rejects.toThrow("Stored venue hours need reconciliation");
    // Actual presence is untouched by untrusted hours.
    expect((await loadPhysicalOccupancy(h.ctx as never)).insideCount).toBe(2);
  });
});

describe("operations exceptions stay visible when a problem recurs", () => {
  it("opens a fresh blocker after a resolved row, keeps the history, and refuses ambiguous resolution", async () => {
    const { h } = setup();
    const ctx = h.ctx as never;
    const input = { category: "ticket_delivery" as const, code: "email_failed", dedupeKey: "delivery:recur", moneyReceived: false, now: 1 };
    await openOperationsException(ctx, input);
    expect(await resolveOperationsException(ctx, "delivery:recur", "email_sent", 2)).toBe(true);
    await openOperationsException(ctx, { ...input, now: 3 });
    await openOperationsException(ctx, { ...input, now: 4 });
    const rows = h.rows("operationsExceptions").filter((row) => row.dedupeKey === "delivery:recur");
    expect(rows.map((row) => [row.status, row.occurrenceCount, row.firstSeenAt])).toEqual([["resolved", 1, 1], ["open", 2, 3]]);
    expect(rows[0]).toMatchObject({ resolution: "email_sent", resolvedAt: 2 });

    // Two open rows for one key are ambiguous: nothing is resolved.
    await openOperationsException(ctx, { ...input, dedupeKey: "delivery:twin" });
    h.seed("operationsExceptions", { ...h.rows("operationsExceptions").find((row) => row.dedupeKey === "delivery:twin")!, _id: undefined });
    expect(await resolveOperationsException(ctx, "delivery:twin", "email_sent", 5)).toBe(false);
    expect(h.rows("operationsExceptions").filter((row) => row.dedupeKey === "delivery:twin").every((row) => row.status === "open")).toBe(true);

    // Money exceptions are never closed by automation.
    await openOperationsException(ctx, { ...input, category: "billing", dedupeKey: "billing:money", moneyReceived: true });
    expect(await resolveOperationsException(ctx, "billing:money", "email_sent", 6)).toBe(false);
  });

  it("re-opens an active billing blocker when a resolved money problem recurs", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    corruptions[0].corrupt(h, sale);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
    const [first] = openBilling(h, sale);
    first.status = "resolved";
    expect(openBilling(h, sale)).toHaveLength(0);
    // The sale is paid with no booking: the recurring problem is visible again.
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
    expect(openBilling(h, sale)).toHaveLength(1);
    expect(paidRows(h, sale)).toHaveLength(1);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
  });
});

describe("open billing exceptions are found past resolved history", () => {
  function seedHistory(h: ConvexHarness, owner: { orderRef: string } | { saleRef: string }) {
    for (let index = 0; index < 50; index += 1) {
      h.seed("operationsExceptions", {
        ...owner, dedupeKey: `history:${JSON.stringify(owner)}:${index}`,
        category: index % 2 ? "billing" : "ticket_delivery", code: "old", status: index % 2 ? "resolved" : "open",
        moneyReceived: false, occurrenceCount: 1, firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1
      });
    }
  }
  const openBillingRow = (owner: { orderRef: string } | { saleRef: string }) => ({
    ...owner, dedupeKey: `open:${JSON.stringify(owner)}`, category: "billing", code: "paid_after_visit_window",
    status: "open", moneyReceived: true, occurrenceCount: 1, firstSeenAt: 2, lastSeenAt: 2, createdAt: 2, updatedAt: 2
  });

  function paidSaleFixture(h: ConvexHarness) {
    const saleRef = `POS-PROOF-${++sequence}`;
    const built = buildPosSaleDraftWrite(
      { admission: { packageKey: "general", adults: 1, children: 1, freeChildren: 1, visitDate: friday, entryTime: "10:00" }, lines: [], idempotencyKey: `pos_proof_${sequence}_key` },
      { saleRef, now: fridayNoon - 3_600_000, staffUserId: "staffUsers|seed-1", actorRole: "pos" }
    );
    h.seed("posSales", { ...built.sale, status: "paid" });
    built.lines.forEach((line) => h.seed("posSaleLines", line));
    const bookingId = h.seed("bookings", {
      bookingRef: saleRef, saleRef, visitDate: friday, entryTime: "10:00", partySize: 3, status: "confirmed", createdAt: 1
    });
    h.seed("paymentEvents", {
      saleRef, provider: "terminal", providerPaymentId: `pi_proof_${sequence}`, providerPaymentIntentId: `pi_proof_${sequence}`,
      status: "paid", currency: "usd", amountCents: built.sale.totalCents, createdAt: 2
    });
    return { saleRef, booking: () => h.rows("bookings").find((row) => row._id === bookingId) as never, totalCents: built.sale.totalCents };
  }

  function paidOrderFixture(h: ConvexHarness) {
    const orderRef = `SKY-PROOF-${++sequence}`;
    const built = buildCheckoutDraftWrite(
      { packageKey: "general", adults: 1, children: 1, freeChildren: 1, visitDate: friday, entryTime: "10:00", idempotencyKey: `order_proof_${sequence}_key` },
      { orderRef, now: fridayNoon - 3_600_000 }
    );
    h.seed("orders", { ...built.order, status: "paid", expectedProvider: "stripe" });
    built.lines.forEach((line) => h.seed("orderLineItems", line));
    const bookingId = h.seed("bookings", {
      bookingRef: orderRef, orderRef, visitDate: friday, entryTime: "10:00", partySize: 3, status: "confirmed", createdAt: 1
    });
    const intentId = `pi_order_proof_${sequence}`;
    const sessionId = `cs_test_proof_${sequence}`;
    h.seed("paymentEvents", {
      orderRef, provider: "stripe", providerPaymentId: sessionId, providerPaymentIntentId: intentId,
      status: "paid", currency: "usd", amountCents: built.order.totalCents, createdAt: 2
    });
    return { orderRef, intentId, sessionId, booking: () => h.rows("bookings").find((row) => row._id === bookingId) as never, totalCents: built.order.totalCents };
  }

  it("requires one exact paid record: duplicates of the same intent, foreign pending rows and overflow all block", async () => {
    const { h } = setup();
    const settledRow = (owner: Record<string, unknown>) =>
      h.rows("paymentEvents").find((row) => row.status === "paid" && Object.entries(owner).every(([key, value]) => row[key] === value))!;
    const copyOf = (row: Record<string, unknown>) => {
      const { _id: _ignored, _creationTime: _time, ...copy } = row as Record<string, unknown> & { _id: string; _creationTime: number };
      return copy;
    };

    // Same intent, same owner, recorded twice: online and POS.
    const order = paidOrderFixture(h);
    h.seed("paymentEvents", copyOf(settledRow({ orderRef: order.orderRef })));
    await expect(assertBookingPaid(h.ctx as never, order.booking())).rejects.toThrow("settled payment needs reconciliation");
    const sale = paidSaleFixture(h);
    h.seed("paymentEvents", copyOf(settledRow({ saleRef: sale.saleRef })));
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).rejects.toThrow("settled payment needs reconciliation");

    // A foreign pending Terminal row for the order's intent.
    const foreign = paidOrderFixture(h);
    h.seed("paymentEvents", {
      saleRef: "POS-FOREIGN", provider: "terminal", providerPaymentId: foreign.intentId, providerPaymentIntentId: foreign.intentId,
      status: "requires_payment", currency: "usd", amountCents: foreign.totalCents, createdAt: 3
    });
    await expect(assertBookingPaid(h.ctx as never, foreign.booking())).rejects.toThrow("payment identity needs reconciliation");

    // A legacy paid row for the same Session but another intent.
    const legacy = paidOrderFixture(h);
    h.seed("paymentEvents", {
      orderRef: "SKY-LEGACY-OWNER", provider: "stripe", providerPaymentId: legacy.sessionId,
      status: "paid", currency: "usd", amountCents: legacy.totalCents, createdAt: 3
    });
    await expect(assertBookingPaid(h.ctx as never, legacy.booking())).rejects.toThrow("payment identity needs reconciliation");

    // A stored amount that is not the order's settled money.
    const wrong = paidOrderFixture(h);
    settledRow({ orderRef: wrong.orderRef }).amountCents = wrong.totalCents + 1;
    await expect(assertBookingPaid(h.ctx as never, wrong.booking())).rejects.toThrow("settled payment needs reconciliation");

    // More than 500 own rows of one status cannot prove exclusive ownership.
    const overflow = paidSaleFixture(h);
    const saleIntent = settledRow({ saleRef: overflow.saleRef }).providerPaymentIntentId as string;
    seedDeclines(h, overflow.saleRef, saleIntent, 501, overflow.totalCents);
    await expect(assertBookingPaid(h.ctx as never, overflow.booking())).rejects.toThrow("payment identity needs reconciliation");
  });

  it("finds the 51st exception for both sale and order and blocks shared paid proof", async () => {
    const { h } = setup();
    const sale = paidSaleFixture(h);
    const order = paidOrderFixture(h);
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).resolves.toBe(3);
    await expect(assertBookingPaid(h.ctx as never, order.booking())).resolves.toBe(3);

    seedHistory(h, { saleRef: sale.saleRef });
    seedHistory(h, { orderRef: order.orderRef });
    expect(await hasOpenBillingExceptionForSale(h.ctx as never, sale.saleRef)).toBe(false);
    expect(await hasOpenBillingExceptionForOrder(h.ctx as never, order.orderRef)).toBe(false);
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).resolves.toBe(3);

    h.seed("operationsExceptions", openBillingRow({ saleRef: sale.saleRef }));
    h.seed("operationsExceptions", openBillingRow({ orderRef: order.orderRef }));
    expect(await openBillingExceptionsForSale(h.ctx as never, sale.saleRef)).toHaveLength(1);
    expect(await openBillingExceptionsForOrder(h.ctx as never, order.orderRef)).toHaveLength(1);
    expect(await hasOpenBillingExceptionForSale(h.ctx as never, sale.saleRef)).toBe(true);
    expect(await hasOpenBillingExceptionForOrder(h.ctx as never, order.orderRef)).toBe(true);
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).rejects.toThrow("billing needs staff review");
    await expect(assertBookingPaid(h.ctx as never, order.booking())).rejects.toThrow("billing needs staff review");

    // Shared ticket view and delivery repair also stop at the 51st row.
    h.seed("ticketDeliveries", {
      ticketCode: ticketCode(), bookingRef: order.orderRef, orderRef: order.orderRef, status: "sent",
      attemptCount: 1, sendVersion: 1, createdAt: 1, updatedAt: 1
    });
    const code = h.rows("ticketDeliveries")[0].ticketCode as string;
    expect((await h.call<{ status: string }>(ticketDelivery.getTicket, { ticketCode: code })).status).toBe("needs-attention");
  });

  it("validates every succeeded refund: corrupt rows fail closed and can never offset a full refund", async () => {
    const { h } = setup();
    const refund = (intentId: string, owner: Record<string, unknown>, amountCents: number, extra: Record<string, unknown> = {}) => ({
      providerRefundId: `re_${++sequence}`, providerPaymentIntentId: intentId, paymentProvider: "stripe", ...owner,
      status: "succeeded", amountCents, currency: "usd", providerEventCreatedAt: 1, rawEventId: `evt_re_${sequence}`,
      createdAt: 1, updatedAt: 1, ...extra
    });

    // A genuine partial refund and failed/canceled history stay admissible.
    const partial = paidOrderFixture(h);
    h.seed("refunds", refund(partial.intentId, { orderRef: partial.orderRef }, 500));
    h.seed("refunds", refund(partial.intentId, { orderRef: partial.orderRef }, partial.totalCents, { status: "failed" }));
    h.seed("refunds", refund(partial.intentId, { orderRef: partial.orderRef }, partial.totalCents, { status: "canceled" }));
    await expect(assertBookingPaid(h.ctx as never, partial.booking())).resolves.toBe(3);

    // A negative row cannot cancel out a full refund and authorize entry.
    const offset = paidOrderFixture(h);
    h.seed("refunds", refund(offset.intentId, { orderRef: offset.orderRef }, offset.totalCents));
    h.seed("refunds", refund(offset.intentId, { orderRef: offset.orderRef }, -offset.totalCents));
    await expect(assertBookingPaid(h.ctx as never, offset.booking())).rejects.toThrow("refund evidence needs reconciliation");

    const corrupt: Array<[string, (fixture: ReturnType<typeof paidOrderFixture>) => Record<string, unknown>]> = [
      ["another order", (f) => refund(f.intentId, { orderRef: "SKY-SOMEONE-ELSE" }, 100)],
      ["a sale owner", (f) => refund(f.intentId, { orderRef: f.orderRef, saleRef: "POS-X" }, 100)],
      ["the wrong provider", (f) => refund(f.intentId, { orderRef: f.orderRef }, 100, { paymentProvider: "terminal" })],
      ["another currency", (f) => refund(f.intentId, { orderRef: f.orderRef }, 100, { currency: "eur" })],
      ["a zero amount", (f) => refund(f.intentId, { orderRef: f.orderRef }, 0)],
      ["a fractional amount", (f) => refund(f.intentId, { orderRef: f.orderRef }, 10.5)]
    ];
    for (const [, build] of corrupt) {
      const fixture = paidOrderFixture(h);
      h.seed("refunds", build(fixture));
      await expect(assertBookingPaid(h.ctx as never, fixture.booking())).rejects.toThrow("refund evidence needs reconciliation");
    }

    const full = paidOrderFixture(h);
    h.seed("refunds", refund(full.intentId, { orderRef: full.orderRef }, full.totalCents));
    await expect(assertBookingPaid(h.ctx as never, full.booking())).rejects.toThrow("payment was fully refunded");

    // A POS sale's own Terminal refund is validated the same way.
    const sale = paidSaleFixture(h);
    const saleIntent = h.rows("paymentEvents").find((row) => row.saleRef === sale.saleRef)!.providerPaymentIntentId as string;
    h.seed("refunds", refund(saleIntent, { saleRef: sale.saleRef }, 100, { paymentProvider: "terminal" }));
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).resolves.toBe(3);
    h.seed("refunds", refund(saleIntent, { saleRef: sale.saleRef }, 100));
    await expect(assertBookingPaid(h.ctx as never, sale.booking())).rejects.toThrow("refund evidence needs reconciliation");
  });

  it("keeps valid paid proof working past declines, failed refunds and resolved history, and still blocks real ambiguity", async () => {
    const { h } = setup();
    const order = paidOrderFixture(h);
    for (let index = 0; index < 150; index += 1) {
      h.seed("paymentEvents", {
        orderRef: order.orderRef, provider: "stripe", providerPaymentId: `cs_test_decline_${index}`,
        status: "failed", currency: "usd", amountCents: order.totalCents, createdAt: 1
      });
      h.seed("paymentEvents", {
        orderRef: order.orderRef, provider: "stripe", providerPaymentId: order.sessionId, providerPaymentIntentId: order.intentId,
        status: "failed", currency: "usd", amountCents: order.totalCents, createdAt: 1
      });
      h.seed("refunds", {
        providerRefundId: `re_failed_${index}`, providerPaymentIntentId: order.intentId, paymentProvider: "stripe",
        orderRef: order.orderRef, status: "failed", amountCents: order.totalCents, currency: "usd",
        providerEventCreatedAt: 1, rawEventId: `evt_refund_${index}`, createdAt: 1, updatedAt: 1
      });
    }
    seedHistory(h, { orderRef: order.orderRef });
    seedHistory(h, { orderRef: order.orderRef });
    await expect(assertBookingPaid(h.ctx as never, order.booking())).resolves.toBe(3);

    h.seed("refunds", {
      providerRefundId: "re_full", providerPaymentIntentId: order.intentId, paymentProvider: "stripe",
      orderRef: order.orderRef, status: "succeeded", amountCents: order.totalCents, currency: "usd",
      providerEventCreatedAt: 1, rawEventId: "evt_refund_full", createdAt: 1, updatedAt: 1
    });
    await expect(assertBookingPaid(h.ctx as never, order.booking())).rejects.toThrow("fully refunded");

    const second = paidOrderFixture(h);
    h.seed("paymentEvents", {
      orderRef: second.orderRef, provider: "stripe", providerPaymentId: "cs_test_second_payment", providerPaymentIntentId: "pi_second_payment",
      status: "paid", currency: "usd", amountCents: second.totalCents, createdAt: 3
    });
    await expect(assertBookingPaid(h.ctx as never, second.booking())).rejects.toThrow("settled payment needs reconciliation");
  });
});

describe("shared physical ledger lookups", () => {
  it("counts a duplicated admitted party once, marks it unverified, and blocks the door explicitly", async () => {
    const { h } = setup();
    otherCheckedIn(h, "SKY-TWIN", false);
    admissionRow(h, "SKY-TWIN", 0);
    admissionRow(h, "SKY-TWIN", 1);
    const physical = await loadPhysicalOccupancy(h.ctx as never);
    expect(physical).toMatchObject({ insideCount: 2, unverifiedReason: "admission_duplicate" });
    expect(physical.admissions).toHaveLength(1);
    expect(await lookupBookingAdmission(h.ctx as never, "SKY-TWIN")).toEqual({ kind: "duplicate" });
    await expect(bookingAdmission(h.ctx as never, "SKY-TWIN")).rejects.toThrow("Admission blocked: occupancy record needs reconciliation");
    // Presence is never dropped: the date stays unverified and still counts the party.
    const date = await occupancy(h);
    expect(date.unverifiedReason).toBeDefined();
    expect(date.intervals.reduce((sum, interval) => sum + interval.partySize, 0)).toBe(2);
  });
});

describe("POS stored line boundary", () => {
  const cafe = (count: number) => Array.from({ length: count }, () => ({ kind: "cafe", itemKey: "b1", quantity: 1 }));
  const allAges = { adults: 1, children: 1, freeChildren: 1 };

  it("accepts 100 stored lines with all three age lines and pays them, keeping the free child in money and count proof", async () => {
    const { h } = setup();
    const sale = await createSale(h, allAges, cafe(97));
    expect(h.rows("posSaleLines").filter((row) => row.saleRef === sale.saleRef)).toHaveLength(100);
    const child = h.rows("posSaleLines").find((row) => row.saleRef === sale.saleRef && row.name === "The View · Child 0–7");
    expect(child).toMatchObject({ quantity: 1, unitAmountCents: 0, lineTotalCents: 0 });
    expect(sale.totalCents).toBe(2000 + 1000 + 0 + 97 * 600);
    expect(holdsFor(h, sale)).toEqual([expect.objectContaining({ partySize: 3 })]);

    await start(h, sale);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    const booking = h.rows("bookings").find((row) => row.saleRef === sale.saleRef)!;
    expect(booking).toMatchObject({ partySize: 3, status: "confirmed" });
    await expect(assertBookingPaid(h.ctx as never, booking as never)).resolves.toBe(3);
  });

  it("rejects the next accepted input (101 stored lines) before any sale or hold", async () => {
    const { h } = setup();
    await expect(createSale(h, allAges, cafe(98))).rejects.toThrow("at most 100 lines including admission age lines");
    expect(h.rows("posSales")).toHaveLength(0);
    expect(h.rows("posSaleLines")).toHaveLength(0);
    expect(h.rows("capacityReservations")).toHaveLength(0);
  });
});

describe("queued sends use canonical paid proof before claiming", () => {
  it("retains a cafe-only payment but reports a billing exception when its repeated receipt has a corrupt cart", async () => {
    const { h } = setup();
    const sale = await createSale(h, null, [{ kind: "cafe", itemKey: "b1", quantity: 1 }]);
    await start(h, sale);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    const moneyBefore = structuredClone(paidRows(h, sale));
    const line = h.rows("posSaleLines").find(row => row.saleRef === sale.saleRef)!;
    line.lineTotalCents = (line.lineTotalCents as number) + 1;
    const scheduledBefore = h.scheduled.length;
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(h, sale)).toEqual(moneyBefore);
    expect(openBilling(h, sale)).toEqual([
      expect.objectContaining({ code: "paid_sale_snapshot_invalid", moneyReceived: true, amountCents: sale.totalCents })
    ]);
    expect(saleRow(h, sale).status).toBe("paid");
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(h.rows("bookingAdmissions")).toHaveLength(0);
    expect(h.scheduled).toHaveLength(scheduledBefore);
  });

  it.each(["duplicate_paid", "foreign_pending", "full_refund", "delivery_owner_mismatch"] as const)("suppresses a queued ticket with %s without sending or changing redemption history", async kind => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    const paid = paidRows(h, sale)[0];
    const delivery = h.rows("ticketDeliveries")[0];
    const booking = h.rows("bookings")[0];
    const bookingBefore = structuredClone(booking);
    if (kind === "duplicate_paid") {
      const { _id: ignoredId, _creationTime: ignoredTime, ...copy } = paid;
      h.seed("paymentEvents", copy);
    } else if (kind === "foreign_pending") h.seed("paymentEvents", {
      saleRef: "POS-OTHER", provider: "terminal", providerPaymentId: paid.providerPaymentId,
      providerPaymentIntentId: paid.providerPaymentIntentId, status: "processing", amountCents: sale.totalCents,
      currency: "usd", createdAt: 1
    });
    else if (kind === "full_refund") h.seed("refunds", {
      providerRefundId: `re_send_${++sequence}`, providerPaymentIntentId: paid.providerPaymentIntentId,
      paymentProvider: "terminal", saleRef: sale.saleRef, status: "succeeded", amountCents: sale.totalCents,
      currency: "usd", providerEventCreatedAt: 1, rawEventId: `evt_send_${sequence}`, createdAt: 1, updatedAt: 1
    });
    else delivery.saleRef = "POS-OTHER";
    const scheduledBefore = h.scheduled.length;
    await expect(h.call(ticketDelivery.claimTicketDelivery, { deliveryId: delivery._id })).resolves.toBeNull();
    expect(h.rows("ticketDeliveries")).toHaveLength(1);
    expect(h.rows("ticketDeliveries")[0]).toMatchObject({ status: "suppressed", attemptCount: 0 });
    expect(h.rows("ticketDeliveries")[0].providerMessageId).toBeUndefined();
    expect(h.rows("bookings")[0]).toEqual(bookingBefore);
    expect(h.rows("bookingAdmissions")).toHaveLength(0);
    expect(h.scheduled).toHaveLength(scheduledBefore);
    expect(paidRows(h, sale)).toHaveLength(kind === "duplicate_paid" ? 2 : 1);
    expect(holdsFor(h, sale)[0].status).toBe("paid");
  });
});

describe("Terminal refunds require the paid provider id to be the same intent", () => {
  it.each(["cancel", "restore"] as const)("retains refund facts without attempting to %s fulfillment from a sole mismatched paid row", async mode => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    const booking = h.rows("bookings")[0];
    vi.setSystemTime(fridayNoon + 3_600_000);
    Object.assign(booking, {
      status: "checked-in", checkedInAt: fridayNoon + 1_800_000, admissionTracked: true,
      admittedPartySize: 2, departedPartySize: 1
    });
    h.seed("bookingAdmissions", {
      bookingRef: booking.bookingRef, visitDate: friday, partySize: 2,
      admittedAt: fridayNoon + 1_800_000, admittedBy: "staffUsers|seed-1", departedCount: 1, inside: true, updatedAt: 1
    });
    holdsFor(h, sale)[0].departedCount = 1;
    const intentId = paidRows(h, sale)[0].providerPaymentIntentId;
    const providerRefundId = `re_terminal_identity_${++sequence}`;
    const refund = (refundStatus: "succeeded" | "failed") => h.call<{ status: string }>(paymentInternals.recordStripeRefundWebhook, {
      providerEventId: `evt_terminal_identity_${++sequence}`, eventType: "refund.updated", outcome: "refund",
      providerRefundId, providerPaymentIntentId: intentId, refundStatus, amountCents: sale.totalCents,
      currency: "usd", providerEventCreatedAt: Date.now(),
      raw: { providerRefundId, providerPaymentIntentId: intentId, refundStatus, amountCents: sale.totalCents }
    });
    if (mode === "restore") {
      await expect(refund("succeeded")).resolves.toMatchObject({ status: "processed" });
      expect(saleRow(h, sale).status).toBe("canceled");
      expect(h.rows("bookings")[0].refundCancellationOwner).toBeDefined();
      vi.setSystemTime(Date.now() + 1000);
    }
    // A lone paid row makes the two identity indexes agree on the same row;
    // it must still fail the Terminal invariant that both ids name the PI.
    const events = h.rows("paymentEvents");
    for (let index = events.length - 1; index >= 0; index--) {
      if (events[index].status !== "paid") events.splice(index, 1);
    }
    paidRows(h, sale)[0].providerPaymentId = "pi_wrong_terminal_paid_identity";
    const state = () => structuredClone({
      sale: saleRow(h, sale), booking: h.rows("bookings")[0], admission: h.rows("bookingAdmissions")[0],
      hold: holdsFor(h, sale)[0], paid: paidRows(h, sale), lines: h.rows("posSaleLines"),
      refunds: h.rows("refunds"), deliveries: h.rows("ticketDeliveries")
    });
    const before = state();
    const scheduledBefore = h.scheduled.length;
    const refundStatus = mode === "restore" ? "failed" : "succeeded";
    await expect(refund(refundStatus)).resolves.toMatchObject({ status: "failed" });
    expect(state()).toEqual(before);
    expect(paidRows(h, sale)).toHaveLength(1);
    expect(openBilling(h, sale)).toEqual([expect.objectContaining({
      code: "refund_payment_identity_unverified", moneyReceived: true, amountCents: sale.totalCents,
      providerPaymentIntentId: intentId, evidence: expect.objectContaining({ providerRefundId, refundStatus })
    })]);
    expect(h.rows("webhookEvents").at(-1)).toMatchObject({
      status: "failed", raw: { providerRefundId, providerPaymentIntentId: intentId, refundStatus, amountCents: sale.totalCents }
    });
    expect(h.rows("auditEvents").some(row => row.action === "payment.refund.fulfillmentRestored")).toBe(false);
    expect(h.scheduled).toHaveLength(scheduledBefore);
  });
});

describe.each(["stripe", "terminal"] as const)("%s refund uncertainty retains provider facts without changing fulfillment", provider => {
  function fixture() {
    const { h } = setup();
    const ref = `REFUND-UNCERTAIN-${provider}-${++sequence}`;
    const intentId = `pi_refund_uncertain_${sequence}`;
    const owner = provider === "stripe" ? { orderRef: ref } : { saleRef: ref };
    const table = provider === "stripe" ? "orders" : "posSales";
    const entityId = h.seed(table, {
      ...owner, status: "paid", expectedProvider: provider, totalCents: 4000, subtotalCents: 4000, feeCents: 0,
      currency: "usd", visitDate: friday, entryTime: "10:00", createdAt: 1, updatedAt: 1
    });
    const bookingId = h.seed("bookings", {
      ...owner, bookingRef: ref, visitDate: friday, entryTime: "10:00", partySize: 2, status: "checked-in",
      checkedInAt: fridayNoon - 1000, admissionTracked: true, admittedPartySize: 2, departedPartySize: 1,
      createdAt: 1, updatedAt: 1
    });
    h.seed("bookingAdmissions", {
      bookingRef: ref, visitDate: friday, partySize: 2, departedCount: 1, inside: true,
      admittedAt: fridayNoon - 1000, admittedBy: "staffUsers|seed-1", updatedAt: 1
    });
    h.seed("capacityReservations", {
      ...owner, bookingRef: ref, visitDate: friday, entryTime: "10:00", partySize: 2,
      departedCount: 1, startMinutes: 600, endMinutes: 1080, status: "paid", createdAt: 1, updatedAt: 1
    });
    h.seed("paymentEvents", {
      ...owner, provider, providerPaymentId: provider === "stripe" ? `cs_refund_${sequence}` : intentId,
      providerPaymentIntentId: intentId, status: "paid", amountCents: 4000, currency: "usd", createdAt: 1
    });
    const providerRefundId = `re_uncertain_${sequence}`;
    const refund = (status: "succeeded" | "failed") => h.call<{ status: string }>(paymentInternals.recordStripeRefundWebhook, {
      providerEventId: `evt_uncertain_${++sequence}`, eventType: "refund.updated", outcome: "refund",
      providerRefundId, providerPaymentIntentId: intentId, refundStatus: status, amountCents: 4000,
      currency: "usd", providerEventCreatedAt: Date.now(),
      raw: { providerRefundId, providerPaymentIntentId: intentId, refundStatus: status, amountCents: 4000 }
    });
    const refundRow = (index: number, extra: Record<string, unknown> = {}) => ({
      ...owner, paymentProvider: provider, providerPaymentIntentId: intentId, providerRefundId: `re_history_${index}_${sequence}`,
      status: "succeeded", amountCents: 1, currency: "usd", providerEventCreatedAt: 1,
      rawEventId: `evt_history_${index}`, createdAt: 1, updatedAt: 1, ...extra
    });
    const state = () => structuredClone({
      entity: h.rows(table).find(row => row._id === entityId), booking: h.rows("bookings").find(row => row._id === bookingId),
      admission: h.rows("bookingAdmissions")[0], hold: h.rows("capacityReservations")[0]
    });
    return { h, ref, owner, intentId, providerRefundId, refund, refundRow, state };
  }

  it("retains a new authoritative refund as an exception when succeeded history exceeds 100", async () => {
    const t = fixture();
    for (let index = 0; index < 101; index++) t.h.seed("refunds", t.refundRow(index));
    const stateBefore = t.state();
    const scheduledBefore = t.h.scheduled.length;
    await expect(t.refund("succeeded")).resolves.toMatchObject({ status: "failed" });
    expect(t.state()).toEqual(stateBefore);
    const exception = t.h.rows("operationsExceptions").find(row => row.category === "billing" && row.status === "open");
    expect(exception).toMatchObject({
      ...t.owner, code: "refund_history_unverified", moneyReceived: true, amountCents: 4000,
      providerPaymentIntentId: t.intentId,
      evidence: { providerRefundId: t.providerRefundId, refundStatus: "succeeded" }
    });
    expect(t.h.rows("webhookEvents")[0]).toMatchObject({
      status: "failed", raw: { providerRefundId: t.providerRefundId, refundStatus: "succeeded", amountCents: 4000 }
    });
    expect(t.h.rows("paymentEvents").filter(row => row.status === "paid")).toHaveLength(1);
    expect(t.h.rows("ticketDeliveries")).toHaveLength(0);
    expect(t.h.scheduled).toHaveLength(scheduledBefore);
    expect(t.h.rows("auditEvents").some(row => row.action === "payment.refund.fulfillmentRestored")).toBe(false);
  });

  it("preserves cancellation ownership and departure history when invalidation audit history overflows", async () => {
    const t = fixture();
    await expect(t.refund("succeeded")).resolves.toMatchObject({ status: "processed" });
    const invalidated = t.h.rows("auditEvents").find(row => row.action === "payment.refund.fulfillmentInvalidated")!;
    for (let index = 0; index < 100; index++) t.h.seed("auditEvents", {
      action: "payment.refund.fulfillmentInvalidated", entityType: provider === "stripe" ? "order" : "posSale",
      entityRef: t.ref, metadata: { providerPaymentIntentId: t.intentId }, createdAt: index
    });
    const stateBefore = t.state();
    const scheduledBefore = t.h.scheduled.length;
    await expect(t.refund("failed")).resolves.toMatchObject({ status: "failed" });
    expect(t.state()).toEqual(stateBefore);
    expect(t.state().booking?.refundCancellationOwner).toBe(invalidated._id);
    expect(t.h.rows("operationsExceptions").find(row => row.status === "open")).toMatchObject({
      ...t.owner, code: "refund_fulfillment_history_unverified", amountCents: 4000,
      evidence: { providerRefundId: t.providerRefundId, refundStatus: "failed" }
    });
    expect(t.h.rows("webhookEvents").at(-1)).toMatchObject({ status: "failed", raw: { refundStatus: "failed", amountCents: 4000 } });
    expect(t.h.rows("ticketDeliveries")).toHaveLength(0);
    expect(t.h.scheduled).toHaveLength(scheduledBefore);
    expect(t.h.rows("auditEvents").some(row => row.action === "payment.refund.fulfillmentRestored")).toBe(false);
  });

  it.each(["negative_amount", "foreign_owner", "wrong_provider", "wrong_currency", "duplicate_identity", "unsafe_sum", "foreign_pending_payment", "distinct_second_payment"] as const)("never restores from %s refund or payment evidence", async kind => {
    const t = fixture();
    await expect(t.refund("succeeded")).resolves.toMatchObject({ status: "processed" });
    if (kind === "foreign_pending_payment" || kind === "distinct_second_payment") {
      const paid = t.h.rows("paymentEvents")[0];
      t.h.seed("paymentEvents", {
        ...(kind === "foreign_pending_payment" ? (provider === "stripe" ? { orderRef: "FOREIGN" } : { saleRef: "FOREIGN" }) : t.owner),
        provider, providerPaymentId: kind === "foreign_pending_payment" ? paid.providerPaymentId : `payment_other_${++sequence}`,
        providerPaymentIntentId: kind === "foreign_pending_payment" ? t.intentId : `pi_other_${sequence}`,
        status: kind === "foreign_pending_payment" ? "processing" : "paid", amountCents: 4000, currency: "usd", createdAt: 1
      });
    } else {
      t.h.seed("refunds", t.refundRow(0, kind === "negative_amount" ? { amountCents: -1 }
        : kind === "foreign_owner" ? (provider === "stripe" ? { orderRef: "FOREIGN" } : { saleRef: "FOREIGN" })
        : kind === "wrong_provider" ? { paymentProvider: provider === "stripe" ? "terminal" : "stripe" }
        : kind === "unsafe_sum" ? { amountCents: Number.MAX_SAFE_INTEGER }
        : kind === "duplicate_identity" ? {}
        : { currency: "eur" }));
      if (kind === "duplicate_identity") t.h.seed("refunds", t.refundRow(0));
      if (kind === "unsafe_sum") t.h.seed("refunds", t.refundRow(1, { amountCents: Number.MAX_SAFE_INTEGER }));
    }
    const stateBefore = t.state();
    await expect(t.refund("failed")).resolves.toMatchObject({ status: "failed" });
    expect(t.state()).toEqual(stateBefore);
    expect(t.h.rows("operationsExceptions").find(row => row.category === "billing" && row.status === "open")).toMatchObject({
      ...t.owner, amountCents: 4000, evidence: { providerRefundId: t.providerRefundId, refundStatus: "failed" }
    });
    expect(t.h.rows("auditEvents").some(row => row.action === "payment.refund.fulfillmentRestored")).toBe(false);
    expect(t.h.rows("ticketDeliveries")).toHaveLength(0);
  });
});
