import { describe, expect, it } from "vitest";

import { getCheckoutReturnStatus } from "./checkoutStatus";
import { buildCheckoutDraftWrite } from "./lib/orderDraftPersistence";

type TableName =
  | "paymentEvents"
  | "orders"
  | "bookings"
  | "ticketDeliveries"
  | "checkoutPaymentAttempts"
  | "operationsExceptions"
  | "orderLineItems"
  | "bookingAdmissions"
  | "refunds";
type Doc = Record<string, unknown>;
type State = Record<TableName, Doc[]>;

const sessionId = "cs_test_abc123xyz7890123";
const orderRef = "SKY2607-ABC123";

async function runStatus(state: State, checkoutSessionId = sessionId) {
  const query = getCheckoutReturnStatus as unknown as {
    _handler: (ctx: ReturnType<typeof createCtx>, args: { checkoutSessionId: string }) => Promise<unknown>;
  };
  return query._handler(createCtx(state), { checkoutSessionId });
}

function createCtx(state: State) {
  return {
    db: {
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            build: (query: { eq: (field: string, value: unknown) => unknown }) => unknown
          ) {
            const filters: Array<{ field: string; value: unknown }> = [];
            const query = {
              eq(field: string, value: unknown) {
                filters.push({ field, value });
                return query;
              }
            };
            build(query);
            const collect = async () =>
              state[table].filter((doc) => filters.every(({ field, value }) => doc[field] === value));
            return {
              collect,
              async first() {
                return (await collect())[0] ?? null;
              },
              async take(count: number) {
                return (await collect()).slice(0, count);
              },
              async unique() {
                const docs = await collect();
                if (docs.length > 1) throw new Error("Expected unique result");
                return docs[0] ?? null;
              }
            };
          }
        };
      }
    }
  };
}

function paidState(): State {
  const built = buildCheckoutDraftWrite({
    packageKey: "general", adults: 1, children: 1, freeChildren: 1,
    visitDate: "2026-10-02", entryTime: "10:00", idempotencyKey: "checkout_status_fixture"
  }, { orderRef, now: 1 });
  const intentId = "pi_checkout_status123456";
  return {
    paymentEvents: [
      { _id: "payment_created", provider: "stripe", providerPaymentId: sessionId, providerPaymentIntentId: intentId, orderRef, status: "created", currency: "usd", amountCents: built.order.totalCents },
      { _id: "payment_paid", provider: "stripe", providerPaymentId: sessionId, providerPaymentIntentId: intentId, orderRef, status: "paid", currency: "usd", amountCents: built.order.totalCents }
    ],
    orders: [{ ...built.order, _id: "order", status: "paid" }],
    orderLineItems: built.lines,
    bookings: [{ _id: "booking", orderRef, bookingRef: orderRef, visitDate: built.order.visitDate, entryTime: built.order.entryTime, partySize: 3, status: "confirmed", emailLower: "must-not-leak@example.com" }],
    ticketDeliveries: [{
      orderRef,
      bookingRef: orderRef,
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      emailLower: "must-not-leak@example.com"
    }],
    checkoutPaymentAttempts: [],
    operationsExceptions: [],
    bookingAdmissions: [],
    refunds: []
  };
}

describe("checkout status query", () => {
  it("confirms from one server-created session without returning PII", async () => {
    await expect(runStatus(paidState())).resolves.toEqual({
      orderRef,
      status: "confirmed",
      bookingRef: orderRef,
      ticketCode: "tkt_0123456789abcdef0123456789abcdef"
    });
  });

  it("does not use paid evidence attached to another order", async () => {
    const state = paidState();
    state.paymentEvents[1] = {
      ...state.paymentEvents[1],
      orderRef: "SKY2607-OTHER1"
    };

    // The Session now names two owners. Complete ownership proof denies the
    // bearer and requires staff attention rather than inviting another payment.
    await expect(runStatus(state)).resolves.toEqual({ orderRef, status: "needs_attention" });
  });

  it("keeps a paid order pending when its booking is missing", async () => {
    const state = paidState();
    state.bookings = [];

    await expect(runStatus(state)).resolves.toEqual({ orderRef, status: "pending" });
  });

  it("reports paid money blocked by a billing exception as needing help, never pending or confirmed", async () => {
    const state = paidState();
    state.bookings = [];
    state.ticketDeliveries = [];
    state.operationsExceptions.push({
      dedupeKey: "billing:paid_after_visit_window:x",
      category: "billing",
      code: "paid_after_visit_window",
      status: "open",
      moneyReceived: true,
      orderRef
    });

    await expect(runStatus(state)).resolves.toEqual({ orderRef, status: "needs_attention" });
  });

  it("rejects unknown session capabilities generically", async () => {
    await expect(runStatus(paidState(), "cs_test_unknown123456789")).rejects.toThrow(
      "Checkout payment was not found"
    );
  });
});
