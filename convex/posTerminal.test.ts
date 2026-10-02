import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as admin from "./admin";
import * as admissions from "./admissions";
import { createConvexHarness, createFakeStripeTerminal, type ConvexHarness } from "./convexHarness.testkit";
import { loadDateOccupancy, loadVenueHours } from "./lib/capacity";
import * as operationsExceptions from "./operationsExceptions";
import * as orderDrafts from "./orderDrafts";
import * as paymentInternals from "./paymentInternals";
import * as payments from "./payments";
import * as posStatus from "./posStatus";
import * as privateEvents from "./privateEvents";
import * as terminalReconciliation from "./terminalReconciliation";
import * as ticketDelivery from "./ticketDelivery";

// Friday 2026-10-02, 12:00 PM in Los Angeles. Friday is open 09:00-18:00 and
// Saturday 10:00-22:00 under the documented default hours.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const friday = "2026-10-02";
const saturday = "2026-10-03";
const minute = 60 * 1000;
const reconcileJob = "terminalReconciliation:reconcileTerminalAttempt";

type Row = Record<string, unknown> & { _id: string };
type Sale = { saleRef: string; idempotencyKey: string; totalCents: number };
type Admission = { adults?: number; children?: number; freeChildren?: number; visitDate?: string; entryTime?: string };

let sequence = 0;
const hexKey = () => (++sequence).toString(16).padStart(64, "0");
const ticketCode = () => `tkt_${String(++sequence).padStart(32, "0")}`;

function setup() {
  const h = createConvexHarness({
    admin,
    admissions,
    operationsExceptions,
    orderDrafts,
    paymentInternals,
    payments,
    posStatus,
    privateEvents,
    terminalReconciliation,
    ticketDelivery
  });
  for (const role of ["admin", "pos", "viewer"] as const) {
    h.seed("staffUsers", { subject: role, emailLower: `${role}@example.com`, role, active: true, createdAt: 1, updatedAt: 1 });
  }
  h.seed("staffUsers", { subject: "pos2", emailLower: "pos2@example.com", role: "pos", active: true, createdAt: 1, updatedAt: 1 });
  const stripe = createFakeStripeTerminal();
  vi.stubGlobal("fetch", vi.fn(stripe.fetch));
  return { h, stripe };
}

async function createSale(
  h: ConvexHarness,
  admission: Admission | null = {},
  lines: Array<Record<string, unknown>> = [],
  as = "pos"
): Promise<Sale> {
  const idempotencyKey = `pos_terminal_${String(++sequence).padStart(6, "0")}`;
  const result = await h.call<{ saleRef: string; totals: { totalCents: number } }>(
    orderDrafts.createPosSaleDraft,
    {
      ...(admission === null
        ? {}
        : { admission: { packageKey: "general", adults: 1, visitDate: friday, entryTime: "12:30", ...admission } }),
      lines,
      customerEmail: "walkup@example.com",
      readerId: "tmr_front123",
      idempotencyKey
    },
    as
  );
  return { saleRef: result.saleRef, idempotencyKey, totalCents: result.totals.totalCents };
}

const start = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.runAction<{ paymentIntentId: string; status: string }>(
    payments.createStripeTerminalPaymentIntent,
    { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey },
    as
  );
const sendToReader = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.runAction<{ paymentIntentId: string; status: string }>(
    payments.processStripeTerminalPaymentIntent,
    { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey },
    as
  );
const refresh = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.runAction<Record<string, unknown>>(payments.refreshStripeTerminalPayment, { saleRef: sale.saleRef }, as);
const saleStatus = (h: ConvexHarness, sale: Sale, as = "pos") =>
  h.call<Record<string, unknown>>(posStatus.getPosSaleStatus, { saleRef: sale.saleRef }, as);

const attemptFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("terminalPaymentAttempts").find((row) => row.saleRef === sale.saleRef) as Row;
const saleRow = (h: ConvexHarness, sale: Sale) => h.rows("posSales").find((row) => row.saleRef === sale.saleRef) as Row;
const holdFor = (h: ConvexHarness, sale: Sale) =>
  h.rows("capacityReservations").find((row) => row.saleRef === sale.saleRef) as Row | undefined;
const paidRows = (h: ConvexHarness, sale: Sale) =>
  h.rows("paymentEvents").filter((row) => row.saleRef === sale.saleRef && row.status === "paid");
const openExceptions = (h: ConvexHarness) => h.rows("operationsExceptions").filter((row) => row.status === "open");

function terminalWebhook(h: ConvexHarness, attempt: Row, overrides: Record<string, unknown> = {}) {
  return h.call<{ status: string; duplicate: boolean }>(paymentInternals.recordStripeTerminalWebhook, {
    providerEventId: `evt_terminal_${++sequence}`,
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

async function placesHeld(h: ConvexHarness, visitDate: string) {
  const occupancy = await loadDateOccupancy(h.ctx as never, visitDate, await loadVenueHours(h.ctx as never));
  return occupancy.intervals.reduce((sum, interval) => sum + interval.partySize, 0);
}

function seedOthers(h: ConvexHarness, visitDate: string, partySize: number) {
  h.seed("capacityReservations", {
    orderRef: `ORD-OTHER-${++sequence}`,
    visitDate,
    entryTime: "10:00",
    startMinutes: 10 * 60,
    endMinutes: 22 * 60,
    partySize,
    status: "paid",
    createdAt: 1,
    updatedAt: 1
  });
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

describe("POS mixed-age admission with a selected visit", () => {
  it("prices adults 20, youths 10 and children free, keeps cafe and custom prices, and holds the whole party atomically", async () => {
    const { h } = setup();
    const sale = await createSale(h, { adults: 2, children: 1, freeChildren: 2 }, [
      { kind: "cafe", itemKey: "b1", quantity: 1 },
      { kind: "custom", name: "Locker", amountCents: 500, reason: "Guest asked" }
    ]);

    expect(sale.totalCents).toBe(2 * 2000 + 1000 + 0 + 600 + 500);
    expect(saleRow(h, sale)).toMatchObject({ status: "draft", visitDate: friday, entryTime: "12:30", expiresAt: fridayNoon + 30 * minute });
    expect(h.rows("posSaleLines").map((line) => [line.name, line.quantity, line.unitAmountCents])).toEqual([
      ["The View · Adult 18+", 2, 2000],
      ["The View · Youth 8–17", 1, 1000],
      ["The View · Child 0–7", 2, 0],
      ["Butter Croissant", 1, 600],
      ["Locker", 1, 500]
    ]);
    expect(holdFor(h, sale)).toMatchObject({ saleRef: sale.saleRef, status: "draft", partySize: 5, visitDate: friday, entryTime: "12:30" });
    expect(holdFor(h, sale)).not.toHaveProperty("orderRef");
    expect(await saleStatus(h, sale)).toMatchObject({
      paymentState: "draft",
      visitDate: friday,
      entryTime: "12:30",
      party: { adults: 2, youths: 1, children: 2, total: 5 }
    });

    // An idempotent retry returns the same sale and hold; a moved visit with
    // the same key is refused.
    const retry = await h.call<{ saleRef: string }>(
      orderDrafts.createPosSaleDraft,
      {
        admission: { packageKey: "general", adults: 2, children: 1, freeChildren: 2, visitDate: friday, entryTime: "12:30" },
        lines: [
          { kind: "cafe", itemKey: "b1", quantity: 1 },
          { kind: "custom", name: "Locker", amountCents: 500, reason: "Guest asked" }
        ],
        customerEmail: "walkup@example.com",
        readerId: "tmr_front123",
        idempotencyKey: sale.idempotencyKey
      },
      "pos"
    );
    expect(retry.saleRef).toBe(sale.saleRef);
    await expect(
      h.call(orderDrafts.createPosSaleDraft, {
        admission: { packageKey: "general", adults: 2, children: 1, freeChildren: 2, visitDate: saturday, entryTime: "12:30" },
        lines: [
          { kind: "cafe", itemKey: "b1", quantity: 1 },
          { kind: "custom", name: "Locker", amountCents: 500, reason: "Guest asked" }
        ],
        customerEmail: "walkup@example.com",
        readerId: "tmr_front123",
        idempotencyKey: sale.idempotencyKey
      }, "pos")
    ).rejects.toThrow("different draft");
    expect(h.rows("capacityReservations")).toHaveLength(1);
  });

  it("keeps cafe-only sales usable with no visit hold and no admission ticket", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h, null, [{ kind: "cafe", itemKey: "b1", quantity: 2 }]);
    expect(h.rows("capacityReservations")).toHaveLength(0);
    expect(saleRow(h, sale)).not.toHaveProperty("visitDate");

    const opened = await start(h, sale);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(new URLSearchParams(stripe.createCalls()[0].body).has("metadata[visit_date]")).toBe(false);
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });

    expect(opened.status).toBe("open");
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(await saleStatus(h, sale)).toMatchObject({ status: "paid", paymentState: "paid" });
    expect((await saleStatus(h, sale)).ticketCode).toBeUndefined();
  });

  it.each([
    ["a past LA date", { visitDate: "2026-10-01" }, "already passed in Los Angeles"],
    ["an entry time already past today", { entryTime: "11:30" }, "already passed today"],
    ["an entry outside Friday hours", { entryTime: "18:00" }, "outside the configured operating hours"],
    ["an entry time that is not offered", { entryTime: "12:15" }, "offered"],
    ["an impossible date", { visitDate: "2026-02-30" }, "real calendar date"],
    ["an undated admission", { visitDate: "" }, "visitDate is required"]
  ])("rejects %s without a sale or hold", async (_label, admission, message) => {
    const { h } = setup();
    await expect(createSale(h, admission)).rejects.toThrow(message);
    expect(h.rows("posSales")).toHaveLength(0);
    expect(h.rows("capacityReservations")).toHaveLength(0);
  });

  it("uses the Los Angeles wall clock after the November DST change", async () => {
    const { h } = setup();
    // 17:30 UTC on Sunday Nov 1 is 09:30 PST (10:30 had PDT been assumed).
    vi.setSystemTime(Date.parse("2026-11-01T17:30:00.000Z"));
    const sale = await createSale(h, { visitDate: "2026-11-01", entryTime: "10:00" });
    expect(holdFor(h, sale)).toMatchObject({ visitDate: "2026-11-01", startMinutes: 600 });
    await expect(createSale(h, { visitDate: "2026-11-01", entryTime: "09:30" })).rejects.toThrow("outside the configured operating hours");
  });

  it("lets only one of concurrent online and POS requests take the last places, and blocks private events over held places", async () => {
    const { h } = setup();
    seedOthers(h, saturday, 28);
    const online = h.call(orderDrafts.createCheckoutOrderDraft, {
      gatewayRateLimitKey: hexKey(),
      packageKey: "general",
      adults: 2,
      visitDate: saturday,
      entryTime: "14:00",
      customerEmail: "guest@example.com",
      idempotencyKey: `checkout_race_${String(++sequence).padStart(6, "0")}`
    });
    const register = createSale(h, { adults: 1, freeChildren: 1, visitDate: saturday, entryTime: "14:00" });
    const results = await Promise.allSettled([online, register]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("no places remain") })
    });
    expect(await placesHeld(h, saturday)).toBe(30);
    await expect(
      h.call(privateEvents.createPrivateEvent, { visitDate: saturday, label: "Buyout", confirmationSource: "owner-confirmation", sourceRef: "Fixture owner confirmation", idempotencyKey: "private_event_race_1" }, "admin")
    ).rejects.toThrow("held or committed visitor places");

    h.seed("privateEvents", {
      eventRef: "PEV20261004-AAAAAA", visitDate: "2026-10-04", status: "confirmed", label: "Wedding",
      idempotencyKey: "private_event_seed_1", requestFingerprint: "v1:seed", createdBy: "staffUsers|seed-1", createdAt: 1, updatedAt: 1
    });
    await expect(createSale(h, { visitDate: "2026-10-04", entryTime: "14:00" })).rejects.toThrow("private event");
  });

  it("releases only an untouched draft through audited release or expiry", async () => {
    const { h } = setup();
    const released = await createSale(h);
    await expect(h.call(orderDrafts.releasePosSaleDraft, { saleRef: released.saleRef, idempotencyKey: released.idempotencyKey }, "pos"))
      .resolves.toEqual({ released: true });
    expect(saleRow(h, released)).toMatchObject({ status: "canceled" });
    expect(holdFor(h, released)).toMatchObject({ status: "released", releaseReason: "pos_draft_released" });
    expect(h.rows("auditEvents").some((row) => row.action === "pos.saleDraft.release" && row.entityRef === released.saleRef)).toBe(true);

    const started = await createSale(h);
    await start(h, started);
    await expect(h.call(orderDrafts.releasePosSaleDraft, { saleRef: started.saleRef, idempotencyKey: started.idempotencyKey }, "pos"))
      .resolves.toEqual({ released: false, status: "payment_pending" });

    const idle = await createSale(h);
    vi.setSystemTime(fridayNoon + 31 * minute);
    await h.runDueJobs((job) => job.name === "orderDrafts:expirePosSaleDraft");
    expect(saleRow(h, idle)).toMatchObject({ status: "expired" });
    expect(holdFor(h, idle)).toMatchObject({ status: "released", releaseReason: "pos_draft_expired" });
    // Expiry never touches a sale whose payment may be payable.
    expect(saleRow(h, started).status).toBe("payment_pending");
    expect(holdFor(h, started)!.status).toBe("payment_pending");
  });
});

describe("durable Terminal attempts", () => {
  it("stores the frozen request and moves the sale and hold to payment_pending before the first POST", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h, { adults: 2, children: 1, freeChildren: 1 });
    const seen: Array<Record<string, unknown>> = [];
    stripe.onRequest(({ method, path }) => {
      if (method !== "POST" || path !== "/payment_intents") return;
      const attempt = attemptFor(h, sale);
      seen.push({
        attemptStatus: attempt?.status,
        frozenBody: new URLSearchParams((attempt?.requestParams as Array<{ name: string; value: string }>).map((p) => [p.name, p.value])).toString(),
        saleStatus: saleRow(h, sale).status,
        holdStatus: holdFor(h, sale)?.status
      });
    });
    stripe.fail("network_before_send");

    await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");

    expect(seen).toEqual([
      { attemptStatus: "creating", frozenBody: stripe.createCalls()[0].body, saleStatus: "payment_pending", holdStatus: "payment_pending" }
    ]);
    const attempt = attemptFor(h, sale);
    expect(attempt).toMatchObject({
      status: "creation_unknown",
      amountCents: 5000,
      currency: "usd",
      stripeMode: "test",
      apiVersion: "2026-02-25.clover",
      readerId: "tmr_front123",
      providerIdempotencyKey: `skyla:terminal-intent:v2:${sale.saleRef}:${attempt.attemptNonce}`,
      providerConfigurationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(JSON.stringify(attempt)).not.toContain("sk_test_terminal_fixture");
    expect(h.scheduled.some((job) => job.name === reconcileJob)).toBe(true);
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "unknown", readerRetryAllowed: false });
  });

  it("stops replaying a stored 500 at the request cap and never creates a second intent", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    stripe.fail("stored_500");
    for (let request = 1; request <= 5; request += 1) {
      // Stripe stored the 500 under the key; each replay returns it unchanged.
      await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");
    }
    await expect(start(h, sale)).rejects.toThrow("payment_needs_attention");

    expect(stripe.createCalls()).toHaveLength(5);
    expect(new Set(stripe.createCalls().map((call) => `${call.idempotencyKey}|${call.body}`)).size).toBe(1);
    expect(stripe.intents.size).toBe(0);
    expect(attemptFor(h, sale)).toMatchObject({ status: "exception", exceptionReason: "terminal_intent_creation_outcome_unknown" });
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
  });

  it.each(["network_before_send", "network_after_create"] as const)(
    "replays only the exact frozen request and key after %s and ends with one intent",
    async (fault) => {
      const { h, stripe } = setup();
      const sale = await createSale(h);
      stripe.fail(fault);
      await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");
      const resumed = await start(h, sale);
      const creates = stripe.createCalls();

      expect(creates).toHaveLength(2);
      expect(creates[1].idempotencyKey).toBe(creates[0].idempotencyKey);
      expect(creates[1].body).toBe(creates[0].body);
      expect(stripe.intents.size).toBe(1);
      expect(attemptFor(h, sale)).toMatchObject({ status: "open", providerPaymentIntentId: resumed.paymentIntentId });
      expect(h.rows("paymentEvents").filter((row) => row.status === "requires_payment")).toHaveLength(1);
      // A double click or reload resumes the stored intent without a POST.
      await expect(start(h, sale)).resolves.toMatchObject({ paymentIntentId: resumed.paymentIntentId });
      expect(stripe.createCalls()).toHaveLength(2);
    }
  );

  it("never replays after the safe window or request cap and keeps the hold as a visible exception", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    stripe.fail("network_before_send");
    await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");
    vi.setSystemTime(fridayNoon + 31 * minute);

    await expect(start(h, sale)).rejects.toThrow("payment_needs_attention");
    await h.runDueJobs();

    expect(stripe.createCalls()).toHaveLength(1);
    expect(attemptFor(h, sale)).toMatchObject({ status: "exception", exceptionReason: "terminal_intent_creation_outcome_unknown" });
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({
      category: "terminal_attempt", code: "terminal_intent_creation_outcome_unknown", moneyReceived: false, saleRef: sale.saleRef
    }));
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "unknown" });
  });

  it("never sends the frozen request under a changed credential or mode", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    stripe.fail("network_before_send");
    await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_another_merchant");
    await expect(start(h, sale)).rejects.toThrow("payment_outcome_unknown");
    vi.setSystemTime(fridayNoon + 5 * minute);
    await h.runDueJobs((job) => job.name === reconcileJob);

    expect(stripe.calls.filter((call) => call.authorization === "Bearer sk_test_another_merchant")).toHaveLength(0);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({ code: "terminal_reconciliation_unconfigured", saleRef: sale.saleRef }));
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
  });

  it("releases the hold only when Stripe refused the only create request", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    stripe.fail("invalid_request");
    await expect(start(h, sale)).rejects.toThrow("rejected");

    expect(attemptFor(h, sale).status).toBe("rejected");
    expect(saleRow(h, sale).status).toBe("canceled");
    expect(holdFor(h, sale)).toMatchObject({ status: "released", releaseReason: "stripe_terminal_creation_rejected" });
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "closed" });
    await expect(start(h, sale)).rejects.toThrow("payment_closed");
    expect(stripe.createCalls()).toHaveLength(1);
  });

  it("reuses the same intent after a reader timeout, a busy reader and a decline", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    const { paymentIntentId } = await start(h, sale);

    stripe.fail("reader_timeout");
    await expect(sendToReader(h, sale)).rejects.toThrow("payment_outcome_unknown");
    expect(attemptFor(h, sale).lastReaderStatus).toBe("unknown:network_error");
    expect(saleRow(h, sale).status).toBe("payment_pending");

    // A repeat handoff first reads the intent; an unreadable state is not
    // presented to the reader again.
    stripe.fail("server_error");
    await expect(sendToReader(h, sale)).rejects.toThrow("refresh_required");
    expect(attemptFor(h, sale).lastReaderStatus).toBe("skipped:unknown");

    // The read passes, then the reader itself is busy.
    stripe.fail("none", "reader_busy");
    await expect(sendToReader(h, sale)).rejects.toThrow("reader_failed");
    expect(attemptFor(h, sale).lastReaderStatus).toBe("failed:stripe_http_400_terminal_reader_busy");
    expect(saleRow(h, sale).status).toBe("payment_pending");

    await expect(sendToReader(h, sale)).resolves.toMatchObject({ paymentIntentId, status: "processing" });
    stripe.decline(paymentIntentId);
    await expect(
      terminalWebhook(h, attemptFor(h, sale), {
        eventType: "payment_intent.payment_failed",
        outcome: "failed",
        intentStatus: "requires_payment_method",
        amountReceivedCents: 0
      })
    ).resolves.toMatchObject({ status: "processed" });
    expect(saleRow(h, sale).status).toBe("payment_pending");
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "awaiting_payment", readerRetryAllowed: true });

    await expect(sendToReader(h, sale)).resolves.toMatchObject({ paymentIntentId });
    const readerCalls = stripe.readerCalls();
    expect(readerCalls.map((call) => new URLSearchParams(call.body).get("payment_intent"))).toEqual(
      readerCalls.map(() => paymentIntentId)
    );
    expect(new Set(readerCalls.map((call) => call.idempotencyKey)).size).toBe(readerCalls.length);
    expect(stripe.createCalls()).toHaveLength(1);
    expect(stripe.intents.size).toBe(1);

    // Once Stripe reports the intent paid, the reader is not sent it again.
    stripe.pay(paymentIntentId);
    await expect(sendToReader(h, sale)).rejects.toThrow("refresh_required");
    expect(stripe.readerCalls()).toHaveLength(readerCalls.length);
  });

  it("recovers a paid intent from a staff Refresh or scheduled read when every webhook is missed", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h, { adults: 1, children: 1, freeChildren: 1, entryTime: "13:00" });
    const { paymentIntentId } = await start(h, sale);
    await sendToReader(h, sale);
    // Reader acknowledgement is never payment.
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "awaiting_payment" });

    stripe.pay(paymentIntentId);
    const refreshed = await refresh(h, sale);
    expect(refreshed).toMatchObject({ refreshed: true, status: "paid", paymentState: "paid", bookingRef: sale.saleRef });
    expect(refreshed.ticketCode).toMatch(/^tkt_[a-f0-9]{32}$/);
    expect(h.rows("bookings")).toEqual([
      expect.objectContaining({ bookingRef: sale.saleRef, saleRef: sale.saleRef, visitDate: friday, entryTime: "13:00", partySize: 3, status: "confirmed" })
    ]);
    expect(holdFor(h, sale)).toMatchObject({ status: "paid", bookingRef: sale.saleRef });
    expect(h.rows("ticketDeliveries")).toEqual([expect.objectContaining({ saleRef: sale.saleRef, status: "queued" })]);

    const second = await createSale(h, { entryTime: "13:30" });
    const secondIntent = await start(h, second);
    stripe.pay(secondIntent.paymentIntentId);
    vi.setSystemTime(Date.now() + 3 * minute);
    await h.runDueJobs((job) => job.name === reconcileJob);
    expect(saleRow(h, second).status).toBe("paid");
    expect(paidRows(h, second)).toHaveLength(1);
  });
});

describe("Terminal settlement", () => {
  it.each([
    ["a livemode mismatch", { livemode: true }, "paid_intent_livemode_mismatch"],
    ["a missing livemode", { livemode: undefined }, "paid_intent_livemode_mismatch"],
    ["an amount mismatch", { amountCents: 1999, amountReceivedCents: 1999 }, "amount_or_currency_mismatch"],
    ["a partial capture", { amountReceivedCents: 1000 }, "paid_intent_amount_received_mismatch"],
    ["a missing attempt nonce", { attemptNonce: undefined }, "attempt_nonce_missing"],
    ["another attempt nonce", { attemptNonce: "f".repeat(32) }, "attempt_nonce_mismatch"],
    ["a foreign source", { intentSource: "dashboard" }, "paid_intent_source_invalid"],
    ["an unsucceeded intent", { intentStatus: "processing" }, "paid_intent_facts_invalid"]
  ])("records %s as an exception without money, booking or ticket", async (_label, overrides, code) => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);

    await expect(terminalWebhook(h, attemptFor(h, sale), overrides)).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(h, sale)).toHaveLength(0);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdFor(h, sale)!.status).toBe("payment_pending");
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({ category: "billing", code, saleRef: sale.saleRef }));
  });

  it("finalizes with a shared-capacity recheck that never counts its own hold", async () => {
    const { h } = setup();
    seedOthers(h, saturday, 25);
    const sale = await createSale(h, { adults: 1, children: 2, freeChildren: 2, visitDate: saturday, entryTime: "14:00" });
    expect(await placesHeld(h, saturday)).toBe(30);
    await start(h, sale);

    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    expect(h.rows("bookings")).toEqual([expect.objectContaining({ partySize: 5, visitDate: saturday, entryTime: "14:00" })]);
    expect(await placesHeld(h, saturday)).toBe(30);
  });

  it("keeps paid money as an immutable exception with no ticket when a private event now blocks the date", async () => {
    const { h } = setup();
    const sale = await createSale(h, { visitDate: saturday, entryTime: "14:00" });
    await start(h, sale);
    h.seed("privateEvents", {
      eventRef: "PEV20261003-AAAAAA", visitDate: saturday, status: "confirmed", label: "Buyout",
      idempotencyKey: "private_event_seed_2", requestFingerprint: "v1:seed", createdBy: "staffUsers|seed-1", createdAt: 1, updatedAt: 1
    });

    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "failed" });
    expect(saleRow(h, sale).status).toBe("paid");
    expect(paidRows(h, sale)).toHaveLength(1);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(h.rows("ticketDeliveries")).toHaveLength(0);
    expect(holdFor(h, sale)).toMatchObject({ status: "exception", exceptionReason: "paid_unfulfilled:paid_sale_capacity_exception" });
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({
      category: "billing", code: "paid_sale_capacity_exception", moneyReceived: true, saleRef: sale.saleRef,
      evidence: expect.objectContaining({ capacityReason: "private_event" })
    }));
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "paid_needs_attention" });
    expect((await saleStatus(h, sale)).ticketCode).toBeUndefined();
  });

  it.each([
    ["paid after closing", "2026-10-03T01:30:00.000Z", "2026-10-03T01:30:00.000Z", "paid_after_visit_window"],
    ["paid before closing but processed after it", "2026-10-03T00:59:00.000Z", "2026-10-03T01:30:00.000Z", "paid_fulfillment_after_visit_window"],
    ["paid on a later LA date", "2026-10-03T17:00:00.000Z", "2026-10-03T17:00:00.000Z", "paid_after_visit_window"]
  ])("does not issue a ticket when %s, and never moves the date", async (_label, paidAt, processedAt, code) => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    vi.setSystemTime(Date.parse(processedAt));

    await terminalWebhook(h, attemptFor(h, sale), { providerEventCreatedAt: Date.parse(paidAt) });
    expect(saleRow(h, sale)).toMatchObject({ status: "paid", visitDate: friday, entryTime: "12:30" });
    expect(paidRows(h, sale)).toHaveLength(1);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({ code, saleRef: sale.saleRef }));
  });

  it("still fulfills a same-day payment after the entry time but before closing", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    vi.setSystemTime(Date.parse("2026-10-03T00:30:00.000Z"));
    await expect(terminalWebhook(h, attemptFor(h, sale))).resolves.toMatchObject({ status: "processed" });
    expect(h.rows("bookings")).toEqual([expect.objectContaining({ visitDate: friday, entryTime: "12:30" })]);
  });

  it("refuses a PaymentIntent already owned by a checkout order or another POS sale", async () => {
    const { h } = setup();
    const first = await createSale(h);
    const second = await createSale(h, { entryTime: "13:00" });
    await start(h, first);
    await start(h, second);
    const firstAttempt = attemptFor(h, first);

    // Same PaymentIntent claimed for another register sale.
    await expect(
      terminalWebhook(h, { ...attemptFor(h, second), providerPaymentIntentId: firstAttempt.providerPaymentIntentId })
    ).resolves.toMatchObject({ status: "failed" });
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({ code: "intent_sale_mismatch", saleRef: second.saleRef }));

    // The same PaymentIntent already paid a checkout order.
    h.seed("paymentEvents", {
      orderRef: "SKY2610-CHECKOUT", provider: "stripe", providerPaymentId: "cs_test_checkout1234",
      providerPaymentIntentId: firstAttempt.providerPaymentIntentId, status: "paid", currency: "usd",
      amountCents: firstAttempt.amountCents, createdAt: 1
    });
    await expect(terminalWebhook(h, firstAttempt)).resolves.toMatchObject({ status: "failed" });
    expect(paidRows(h, first)).toHaveLength(0);
    expect(paidRows(h, second)).toHaveLength(0);
    expect(h.rows("bookings")).toHaveLength(0);
    expect(openExceptions(h)).toContainEqual(expect.objectContaining({ code: "paid_payment_identity_reused", saleRef: first.saleRef }));
  });

  it("creates one money record, booking, ticket and delivery across repeated, reordered and provider-read outcomes, and never resets admission", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h, { adults: 2, freeChildren: 1, entryTime: "12:00" });
    const { paymentIntentId } = await start(h, sale);
    const attempt = attemptFor(h, sale);
    stripe.pay(paymentIntentId);

    const firstEvent = `evt_terminal_first_${++sequence}`;
    await expect(terminalWebhook(h, attempt, { providerEventId: firstEvent })).resolves.toMatchObject({ status: "processed" });
    await expect(terminalWebhook(h, attempt, { providerEventId: firstEvent })).resolves.toMatchObject({ duplicate: true });
    await expect(terminalWebhook(h, attempt)).resolves.toMatchObject({ status: "processed" });
    await refresh(h, sale);
    // A reordered decline or cancellation cannot reopen a paid sale.
    await expect(
      terminalWebhook(h, attempt, { eventType: "payment_intent.canceled", outcome: "canceled", intentStatus: "canceled" })
    ).resolves.toMatchObject({ status: "failed" });

    expect(paidRows(h, sale)).toHaveLength(1);
    expect(h.rows("bookings")).toHaveLength(1);
    expect(h.rows("ticketDeliveries")).toHaveLength(1);
    expect(h.scheduled.filter((job) => job.name === "ticketDelivery:sendTicketConfirmation")).toHaveLength(1);
    expect(saleRow(h, sale).status).toBe("paid");
    expect(holdFor(h, sale)!.status).toBe("paid");

    // The paid register booking admits once through the shared admission path.
    await expect(h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos"))
      .resolves.toMatchObject({ admissionOutcome: "admitted" });
    await h.call(admissions.recordDeparture, { bookingRef: sale.saleRef, departedCount: 3 }, "pos");
    const admissionBefore = structuredClone(h.rows("bookingAdmissions"));
    expect(holdFor(h, sale)).toMatchObject({ departedCount: 3, departedAt: expect.any(Number) });

    await terminalWebhook(h, attempt);
    await h.call(paymentInternals.recordStripeRefundWebhook, {
      providerEventId: `evt_refund_${++sequence}`, eventType: "refund.updated", outcome: "refund",
      providerRefundId: "re_pos_full", providerPaymentIntentId: paymentIntentId, refundStatus: "succeeded",
      amountCents: attempt.amountCents, currency: "usd", providerEventCreatedAt: Date.now()
    });
    expect(h.rows("bookingAdmissions")).toEqual(admissionBefore);
    await expect(h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos"))
      .resolves.toMatchObject({ admissionOutcome: "already_admitted" });
    expect(h.rows("bookingAdmissions")).toHaveLength(1);
  });

  it("releases places only for a correlated provider cancellation", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    const { paymentIntentId } = await start(h, sale);
    stripe.cancel(paymentIntentId);

    const refreshed = await refresh(h, sale);
    expect(refreshed).toMatchObject({ paymentState: "canceled", status: "canceled" });
    expect(holdFor(h, sale)).toMatchObject({ status: "released", releaseReason: "stripe:intent_canceled_reconciled" });
  });

  it("guards ticket display for a POS booking with an open billing exception", async () => {
    const { h } = setup();
    const sale = await createSale(h);
    await start(h, sale);
    await terminalWebhook(h, attemptFor(h, sale));
    const code = h.rows("ticketDeliveries")[0].ticketCode as string;
    expect((await h.call<{ status: string }>(ticketDelivery.getTicket, { ticketCode: code })).status).toBe("confirmed");

    h.seed("operationsExceptions", {
      dedupeKey: "billing:test:sale", category: "billing", code: "duplicate_payment_for_sale", status: "open", moneyReceived: true,
      saleRef: sale.saleRef, occurrenceCount: 1, firstSeenAt: 1, lastSeenAt: 1, createdAt: 1, updatedAt: 1
    });
    expect((await h.call<{ status: string }>(ticketDelivery.getTicket, { ticketCode: code })).status).toBe("needs-attention");
    expect(await saleStatus(h, sale)).toMatchObject({ paymentState: "paid_needs_attention" });
    await expect(h.call(admin.updateBookingStatus, { bookingRef: sale.saleRef, status: "checked-in" }, "pos")).rejects.toThrow("billing");
  });
});

describe("staff boundaries", () => {
  it("keeps viewers, anonymous callers and another cashier out while permitting an admin handover", async () => {
    const { h, stripe } = setup();
    await expect(createSale(h, {}, [], "viewer")).rejects.toThrow("Staff role");
    const sale = await createSale(h);
    await expect(start(h, sale, "viewer")).rejects.toThrow("Staff role");
    await expect(start(h, sale, "pos2")).rejects.toThrow("different staff user");
    await expect(h.call(orderDrafts.releasePosSaleDraft, { saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey }, "pos2"))
      .rejects.toThrow("different staff user");
    expect(stripe.calls).toHaveLength(0);

    await start(h, sale);
    await expect(sendToReader(h, sale, "pos2")).rejects.toThrow("different staff user");
    const providerCallsBeforeForeignRead = stripe.calls.length;
    await expect(saleStatus(h, sale, "pos2")).rejects.toThrow("different staff user");
    await expect(refresh(h, sale, "pos2")).rejects.toThrow("different staff user");
    expect(stripe.calls).toHaveLength(providerCallsBeforeForeignRead);
    await expect(saleStatus(h, sale, "admin")).resolves.toMatchObject({ paymentState: "awaiting_payment" });
    await expect(refresh(h, sale, "admin")).resolves.toMatchObject({ paymentState: "awaiting_payment" });
    await expect(h.runAction(payments.refreshStripeTerminalPayment, { saleRef: sale.saleRef })).rejects.toThrow("Staff authentication");
    await expect(saleStatus(h, sale, "viewer")).rejects.toThrow("Staff role");
  });

  it("stays closed without Terminal acceptance or a configured key, before any write", async () => {
    const { h, stripe } = setup();
    const sale = await createSale(h);
    vi.stubEnv("SKYLA_POS_TERMINAL_ACCEPTANCE", "");
    await expect(start(h, sale)).rejects.toThrow("SKYLA_POS_TERMINAL_ACCEPTANCE");
    vi.stubEnv("SKYLA_POS_TERMINAL_ACCEPTANCE", "enabled");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(start(h, sale)).rejects.toThrow("STRIPE_SECRET_KEY");
    expect(stripe.calls).toHaveLength(0);
    expect(h.rows("terminalPaymentAttempts")).toHaveLength(0);
    expect(saleRow(h, sale).status).toBe("draft");
    expect(holdFor(h, sale)!.status).toBe("draft");
  });
});
