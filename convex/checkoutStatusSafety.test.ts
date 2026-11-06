import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as checkoutStatus from "./checkoutStatus";
import { createConvexHarness, type ConvexHarness } from "./convexHarness.testkit";
import { buildCheckoutDraftWrite } from "./lib/orderDraftPersistence";

// Friday 2026-10-02, 12:00 PM in Los Angeles; the visit is on Saturday.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const visitDate = "2026-10-03";

type Fixture = { orderRef: string; idempotencyKey: string; sessionId: string; totalCents: number; intentId: string };

let sequence = 0;
const ticketCode = () => `tkt_${String(++sequence).padStart(32, "0")}`;

function setup() {
  return createConvexHarness({ checkoutStatus });
}

/** A stored online order with a Convex-created Session; no provider is used. */
function order(h: ConvexHarness, status: "draft" | "payment_pending" | "paid" = "paid", options: { created?: boolean; declinesFirst?: number } = {}): Fixture {
  sequence += 1;
  const orderRef = `SKY-RETURN-${sequence}`;
  const idempotencyKey = `return_status_${sequence}_key`;
  const sessionId = `cs_test_returnstatus${String(sequence).padStart(8, "0")}`;
  const built = buildCheckoutDraftWrite(
    { packageKey: "general", adults: 1, children: 1, visitDate, entryTime: "14:00", idempotencyKey },
    { orderRef, now: fridayNoon - 60_000 }
  );
  h.seed("orders", { ...built.order, status, expectedProvider: "stripe" });
  built.lines.forEach((line) => h.seed("orderLineItems", line));
  for (let index = 0; index < (options.declinesFirst ?? 0); index += 1) {
    h.seed("paymentEvents", {
      orderRef, provider: "stripe", providerPaymentId: sessionId, status: "failed", currency: "usd",
      amountCents: built.order.totalCents, createdAt: 1
    });
  }
  if (options.created !== false) {
    h.seed("paymentEvents", {
      orderRef, provider: "stripe", providerPaymentId: sessionId, status: "created", currency: "usd",
      amountCents: built.order.totalCents, createdAt: 2
    });
  }
  return { orderRef, idempotencyKey, sessionId, totalCents: built.order.totalCents, intentId: `pi_return_${sequence}` };
}

function paid(h: ConvexHarness, f: Fixture, options: { delivery?: boolean } = {}) {
  h.seed("paymentEvents", {
    orderRef: f.orderRef, provider: "stripe", providerPaymentId: f.sessionId, providerPaymentIntentId: f.intentId,
    status: "paid", currency: "usd", amountCents: f.totalCents, createdAt: 3
  });
  h.seed("bookings", {
    bookingRef: f.orderRef, orderRef: f.orderRef, visitDate, entryTime: "14:00", partySize: 2, status: "confirmed",
    emailLower: "guest@example.com", createdAt: 3
  });
  if (options.delivery !== false) {
    h.seed("ticketDeliveries", {
      ticketCode: ticketCode(), bookingRef: f.orderRef, orderRef: f.orderRef, emailLower: "guest@example.com",
      status: "sent", attemptCount: 1, sendVersion: 1, createdAt: 3, updatedAt: 3
    });
  }
}

const byKey = (h: ConvexHarness, f: Fixture) =>
  h.call<Record<string, unknown>>(checkoutStatus.getCheckoutAttemptStatus, { orderRef: f.orderRef, idempotencyKey: f.idempotencyKey });
const bySession = (h: ConvexHarness, f: Fixture) =>
  h.call<Record<string, unknown>>(checkoutStatus.getCheckoutReturnStatus, { checkoutSessionId: f.sessionId });

async function expectAttention(h: ConvexHarness, f: Fixture) {
  for (const result of [await byKey(h, f), await bySession(h, f)]) {
    expect(result).toEqual({ orderRef: f.orderRef, status: "needs_attention" });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkout status reads semantic, indexed payment subsets", () => {
  it("confirms a paid order with canonical proof even after 60 earlier declines", async () => {
    const h = setup();
    const f = order(h, "paid", { declinesFirst: 60 });
    paid(h, f);
    for (const result of [await byKey(h, f), await bySession(h, f)]) {
      expect(result).toMatchObject({ orderRef: f.orderRef, status: "confirmed", bookingRef: f.orderRef, ticketCode: expect.any(String) });
    }
  });

  it("never reports not_started for a legacy Session created after 60 declines", async () => {
    const h = setup();
    const f = order(h, "draft", { declinesFirst: 60 });
    const result = await byKey(h, f);
    expect(result.status).not.toBe("not_started");
    expect(result.status).not.toBe("awaiting_payment");
    expect(result).not.toHaveProperty("ticketCode");
  });

  it("still reports not_started only for a draft with no Session at all", async () => {
    const h = setup();
    const f = order(h, "draft", { created: false });
    expect(await byKey(h, f)).toEqual({ orderRef: f.orderRef, status: "not_started" });
  });

  it("finds an open billing exception behind 50 resolved and non-billing rows", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    for (let index = 0; index < 50; index += 1) {
      h.seed("operationsExceptions", {
        orderRef: f.orderRef, dedupeKey: `history:${index}`, category: index % 2 ? "billing" : "ticket_delivery", code: "old",
        status: index % 2 ? "resolved" : "open", moneyReceived: false, occurrenceCount: 1, firstSeenAt: 1, lastSeenAt: 1,
        createdAt: 1, updatedAt: 1
      });
    }
    expect((await byKey(h, f)).status).toBe("confirmed");
    h.seed("operationsExceptions", {
      orderRef: f.orderRef, dedupeKey: "open:billing", category: "billing", code: "paid_after_visit_window", status: "open",
      moneyReceived: true, occurrenceCount: 1, firstSeenAt: 2, lastSeenAt: 2, createdAt: 2, updatedAt: 2
    });
    await expectAttention(h, f);
  });
});

describe("checkout status fails closed on duplicate or malformed proof", () => {
  it("withholds confirmation for two distinct paid records", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.seed("paymentEvents", {
      orderRef: f.orderRef, provider: "stripe", providerPaymentId: f.sessionId, providerPaymentIntentId: "pi_second_charge",
      status: "paid", currency: "usd", amountCents: f.totalCents, createdAt: 4
    });
    await expectAttention(h, f);
  });

  it("withholds confirmation for a paid record whose amount does not match the order", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.rows("paymentEvents").find((row) => row.status === "paid")!.amountCents = f.totalCents - 100;
    await expectAttention(h, f);
  });

  it("withholds confirmation for a paid intent also recorded under another order", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.seed("paymentEvents", {
      orderRef: "SKY-SOMEONE-ELSE", provider: "stripe", providerPaymentId: "cs_test_someoneelse0000", providerPaymentIntentId: f.intentId,
      status: "paid", currency: "usd", amountCents: f.totalCents, createdAt: 4
    });
    await expectAttention(h, f);
  });

  it("returns attention instead of throwing for duplicate bookings or deliveries", async () => {
    const h = setup();
    const bookings = order(h);
    paid(h, bookings);
    h.seed("bookings", {
      bookingRef: `${bookings.orderRef}-B`, orderRef: bookings.orderRef, visitDate, entryTime: "14:00", partySize: 2,
      status: "confirmed", createdAt: 4
    });
    await expectAttention(h, bookings);

    const deliveries = order(h);
    paid(h, deliveries);
    h.seed("ticketDeliveries", {
      ticketCode: ticketCode(), bookingRef: deliveries.orderRef, orderRef: deliveries.orderRef, status: "queued",
      attemptCount: 0, sendVersion: 1, createdAt: 4, updatedAt: 4
    });
    await expectAttention(h, deliveries);
  });

  it("never confirms a Session claimed by two orders, and names only the one Convex attempt", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.seed("paymentEvents", {
      orderRef: "SKY-CLAIMS-SESSION", provider: "stripe", providerPaymentId: f.sessionId, status: "created", currency: "usd",
      amountCents: f.totalCents, createdAt: 4
    });
    expect(await bySession(h, f)).toEqual({ orderRef: "", status: "needs_attention" });

    h.seed("checkoutPaymentAttempts", { orderRef: f.orderRef, providerSessionId: f.sessionId, status: "paid", expiresAt: 0 });
    expect(await bySession(h, f)).toEqual({ orderRef: f.orderRef, status: "needs_attention" });
  });

  it("fails closed on a second Session claimant hidden behind more than 100 Session events", async () => {
    const h = setup();
    const f = order(h, "paid", { declinesFirst: 120 });
    paid(h, f);
    expect((await bySession(h, f)).status).toBe("confirmed");
    h.seed("paymentEvents", {
      orderRef: "SKY-LATE-CLAIMANT", provider: "stripe", providerPaymentId: f.sessionId, status: "created", currency: "usd",
      amountCents: f.totalCents, createdAt: 5
    });
    expect(await bySession(h, f)).toEqual({ orderRef: "", status: "needs_attention" });
  });

  it("fails closed when the Session's created claimants exceed the read bound", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    for (let index = 0; index < 50; index += 1) {
      h.seed("paymentEvents", {
        orderRef: f.orderRef, provider: "stripe", providerPaymentId: f.sessionId, status: "created", currency: "usd",
        amountCents: f.totalCents, createdAt: 4
      });
    }
    expect(await bySession(h, f)).toEqual({ orderRef: "", status: "needs_attention" });
  });

  it("recovers a legacy Session created after 120 declines instead of not found or not_started", async () => {
    const h = setup();
    const f = order(h, "payment_pending", { declinesFirst: 120 });
    const returned = await bySession(h, f);
    expect(returned.orderRef).toBe(f.orderRef);
    expect(returned.status).not.toBe("confirmed");
    expect(returned).not.toHaveProperty("ticketCode");
    expect((await byKey(h, f)).status).not.toBe("not_started");
  });

  it("returns attention for two stored attempts of one order in both queries", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.seed("checkoutPaymentAttempts", { orderRef: f.orderRef, providerSessionId: f.sessionId, status: "paid", expiresAt: 0 });
    h.seed("checkoutPaymentAttempts", { orderRef: f.orderRef, status: "open", expiresAt: fridayNoon + 60_000 });
    await expectAttention(h, f);
  });

  it("never confirms when a Session status row belongs to another owner", async () => {
    const h = setup();
    const f = order(h, "paid", { declinesFirst: 60 });
    paid(h, f);
    h.seed("paymentEvents", {
      orderRef: "SKY-OTHER-PAYER", provider: "stripe", providerPaymentId: f.sessionId, providerPaymentIntentId: "pi_other_payer",
      status: "paid", currency: "usd", amountCents: f.totalCents, createdAt: 5
    });
    const returned = await bySession(h, f);
    expect(returned).toEqual({ orderRef: f.orderRef, status: "needs_attention" });
  });

  it("keeps a redeemed ticket financially confirmed without offering its code again", async () => {
    const h = setup();
    const f = order(h);
    paid(h, f);
    h.seed("bookingAdmissions", {
      bookingRef: f.orderRef, visitDate, partySize: 2, admittedAt: fridayNoon, admittedBy: "staffUsers|seed-1",
      departedCount: 0, inside: true, updatedAt: fridayNoon
    });
    for (const result of [await byKey(h, f), await bySession(h, f)]) {
      expect(result).toEqual({ orderRef: f.orderRef, status: "confirmed", bookingRef: f.orderRef });
    }
  });

  it("does not resolve an unknown Session or a wrong private key", async () => {
    const h = setup();
    const f = order(h);
    await expect(
      h.call(checkoutStatus.getCheckoutReturnStatus, { checkoutSessionId: "cs_test_unknownsession00000" })
    ).rejects.toThrow("not found");
    await expect(
      h.call(checkoutStatus.getCheckoutAttemptStatus, { orderRef: f.orderRef, idempotencyKey: "wrong_private_key_0001" })
    ).rejects.toThrow("not found");
  });
});
