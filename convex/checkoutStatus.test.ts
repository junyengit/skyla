import { describe, expect, it } from "vitest";

import { getCheckoutReturnStatus } from "./checkoutStatus";

type TableName = "paymentEvents" | "orders" | "bookings";
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
              async unique() {
                const docs = await collect();
                if (docs.length > 1) throw new Error("Expected unique result");
                return docs[0];
              }
            };
          }
        };
      }
    }
  };
}

function paidState(): State {
  return {
    paymentEvents: [
      { provider: "stripe", providerPaymentId: sessionId, orderRef, status: "created" },
      { provider: "stripe", providerPaymentId: sessionId, orderRef, status: "paid" }
    ],
    orders: [{ orderRef, channel: "online", status: "paid" }],
    bookings: [{ orderRef, bookingRef: orderRef, status: "confirmed", emailLower: "must-not-leak@example.com" }]
  };
}

describe("checkout status query", () => {
  it("confirms from one server-created session without returning PII", async () => {
    await expect(runStatus(paidState())).resolves.toEqual({ orderRef, status: "confirmed" });
  });

  it("does not use paid evidence attached to another order", async () => {
    const state = paidState();
    state.paymentEvents[1] = {
      provider: "stripe",
      providerPaymentId: sessionId,
      orderRef: "SKY2607-OTHER1",
      status: "paid"
    };

    await expect(runStatus(state)).resolves.toEqual({ orderRef, status: "pending" });
  });

  it("keeps a paid order pending when its booking is missing", async () => {
    const state = paidState();
    state.bookings = [];

    await expect(runStatus(state)).resolves.toEqual({ orderRef, status: "pending" });
  });

  it("rejects unknown session capabilities generically", async () => {
    await expect(runStatus(paidState(), "cs_test_unknown123456789")).rejects.toThrow(
      "Checkout payment was not found"
    );
  });
});
