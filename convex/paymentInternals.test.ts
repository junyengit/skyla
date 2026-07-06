import { describe, expect, it } from "vitest";

import { stripeTerminalIntentIdempotencyKey } from "./lib/stripeTerminal";
import { recordStripeCheckoutWebhook, recordStripeTerminalWebhook } from "./paymentInternals";

type TableName = "orders" | "posSales" | "paymentEvents" | "webhookEvents" | "auditEvents";
type MockDoc = Record<string, unknown> & { _id: string; _creationTime: number };
type MockState = Record<TableName, MockDoc[]>;
type MockCtx = {
  db: {
    query: (table: TableName) => {
      withIndex: (
        indexName: string,
        buildQuery: (query: { eq: (field: string, value: unknown) => { eq: (field: string, value: unknown) => unknown } }) => unknown
      ) => {
        first: () => Promise<MockDoc | undefined>;
        unique: () => Promise<MockDoc | undefined>;
        collect: () => Promise<MockDoc[]>;
      };
    };
    insert: (table: TableName, doc: Record<string, unknown>) => Promise<string>;
    patch: (id: string, update: Record<string, unknown>) => Promise<void>;
  };
};
type TerminalWebhookArgs = {
  providerEventId: string;
  eventType: string;
  outcome: "paid" | "failed" | "canceled" | "ignored";
  providerPaymentId?: string;
  saleRef?: string;
  amountCents?: number;
  currency?: "usd";
  raw?: Record<string, unknown>;
};
type TerminalWebhookResult = {
  status: "processed" | "ignored" | "failed";
  duplicate: boolean;
  saleRef?: string;
};
type CheckoutWebhookArgs = {
  providerEventId: string;
  eventType: string;
  outcome: "paid" | "failed" | "canceled" | "ignored";
  providerPaymentId?: string;
  orderRef?: string;
  amountCents?: number;
  currency?: "usd";
  raw?: Record<string, unknown>;
};
type CheckoutWebhookResult = {
  status: "processed" | "ignored" | "failed";
  duplicate: boolean;
  orderRef?: string;
};

const orderRef = "ORD260704-ABC123";
const saleRef = "SALE260704-ABC123";
const providerPaymentId = "pi_terminal_123";
const checkoutProviderPaymentId = "cs_test_123";

describe("Stripe Checkout webhook internals", () => {
  it("marks a stored checkout order paid when the signed webhook matches the stored payment session", async () => {
    const { ctx, state } = createCheckoutWebhookCtx();

    const result = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_paid",
      eventType: "checkout.session.completed",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd",
      raw: { payment_status: "paid" }
    });

    expect(result).toEqual({ status: "processed", duplicate: false, orderRef });
    expect(state.orders[0].status).toBe("paid");
    expect(state.paymentEvents.some((event) => event.status === "paid" && event.rawEventId === "evt_checkout_paid")).toBe(true);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "stripe",
      providerEventId: "evt_checkout_paid",
      status: "processed",
      orderRef
    });
  });

  it("returns duplicate for a replayed Checkout webhook event id", async () => {
    const { ctx, state } = createCheckoutWebhookCtx();

    const firstResult = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_paid_replay",
      eventType: "checkout.session.completed",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd",
      raw: { payment_status: "paid" }
    });
    const replayResult = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_paid_replay",
      eventType: "checkout.session.completed",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd",
      raw: { payment_status: "paid" }
    });

    expect(firstResult).toEqual({ status: "processed", duplicate: false, orderRef });
    expect(replayResult).toEqual({ status: "processed", duplicate: true, orderRef });
    expect(state.webhookEvents).toHaveLength(1);
  });

  it("fails Checkout webhooks whose Stripe amount does not match the stored order", async () => {
    const { ctx, state } = createCheckoutWebhookCtx();

    const result = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_amount_mismatch",
      eventType: "checkout.session.completed",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 1,
      currency: "usd",
      raw: { payment_status: "paid" }
    });

    expect(result).toEqual({ status: "failed", duplicate: false, orderRef });
    expect(state.orders[0].status).toBe("payment_pending");
    expect(state.paymentEvents).toHaveLength(1);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "stripe",
      providerEventId: "evt_checkout_amount_mismatch",
      status: "failed",
      orderRef
    });
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "amount_or_currency_mismatch" });
  });

  it("does not record a contradictory failed payment event after a Checkout order is paid", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });

    const result = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_late_canceled",
      eventType: "checkout.session.expired",
      outcome: "canceled",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd",
      raw: { payment_status: "unpaid" }
    });

    expect(result).toEqual({ status: "failed", duplicate: false, orderRef });
    expect(state.orders[0].status).toBe("paid");
    expect(state.paymentEvents).toHaveLength(2);
    expect(state.paymentEvents.some((event) => event.status === "canceled" && event.rawEventId === "evt_checkout_late_canceled")).toBe(false);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "stripe",
      providerEventId: "evt_checkout_late_canceled",
      status: "failed",
      orderRef
    });
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "order_already_paid" });
  });
});

describe("Stripe Terminal webhook internals", () => {
  it("marks a stored POS sale paid when the signed webhook matches the stored ledger", async () => {
    const { ctx, state } = createTerminalWebhookCtx();

    const result = await runTerminalWebhook(ctx, {
      providerEventId: "evt_terminal_paid",
      eventType: "payment_intent.succeeded",
      outcome: "paid",
      providerPaymentId,
      saleRef,
      amountCents: 4200,
      currency: "usd",
      raw: { reason: "paid" }
    });

    expect(result).toEqual({ status: "processed", duplicate: false, saleRef });
    expect(state.posSales[0].status).toBe("paid");
    expect(state.paymentEvents.some((event) => event.status === "paid" && event.rawEventId === "evt_terminal_paid")).toBe(true);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "terminal",
      providerEventId: "evt_terminal_paid",
      status: "processed",
      saleRef
    });
  });

  it("fails non-ignored Terminal webhooks that omit the Stripe amount or currency", async () => {
    const { ctx, state } = createTerminalWebhookCtx();

    const result = await runTerminalWebhook(ctx, {
      providerEventId: "evt_terminal_missing_amount",
      eventType: "payment_intent.succeeded",
      outcome: "paid",
      providerPaymentId,
      saleRef,
      currency: "usd",
      raw: { reason: "paid" }
    });

    expect(result).toEqual({ status: "failed", duplicate: false, saleRef });
    expect(state.posSales[0].status).toBe("payment_pending");
    expect(state.paymentEvents).toHaveLength(1);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "terminal",
      providerEventId: "evt_terminal_missing_amount",
      status: "failed",
      saleRef
    });
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "missing_terminal_amount_or_currency" });
  });

  it("does not reopen a canceled POS sale when a later failure webhook arrives", async () => {
    const { ctx, state } = createTerminalWebhookCtx({ saleStatus: "canceled", terminalStatus: "canceled" });

    const result = await runTerminalWebhook(ctx, {
      providerEventId: "evt_terminal_late_failed",
      eventType: "payment_intent.payment_failed",
      outcome: "failed",
      providerPaymentId,
      saleRef,
      amountCents: 4200,
      currency: "usd",
      raw: { reason: "payment_failed" }
    });

    expect(result).toEqual({ status: "failed", duplicate: false, saleRef });
    expect(state.posSales[0].status).toBe("canceled");
    expect(state.paymentEvents).toHaveLength(1);
    expect(state.webhookEvents[0]).toMatchObject({
      provider: "terminal",
      providerEventId: "evt_terminal_late_failed",
      status: "failed",
      saleRef
    });
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "pos_sale_already_canceled" });
  });
});

async function runTerminalWebhook(ctx: MockCtx, args: TerminalWebhookArgs): Promise<TerminalWebhookResult> {
  const mutation = recordStripeTerminalWebhook as unknown as {
    _handler: (ctx: MockCtx, args: TerminalWebhookArgs) => Promise<TerminalWebhookResult>;
  };
  return mutation._handler(ctx, args);
}

async function runCheckoutWebhook(ctx: MockCtx, args: CheckoutWebhookArgs): Promise<CheckoutWebhookResult> {
  const mutation = recordStripeCheckoutWebhook as unknown as {
    _handler: (ctx: MockCtx, args: CheckoutWebhookArgs) => Promise<CheckoutWebhookResult>;
  };
  return mutation._handler(ctx, args);
}

function createCheckoutWebhookCtx(
  options: { orderStatus?: string; includePaidEvent?: boolean } = {}
): { ctx: MockCtx; state: MockState } {
  const state = createEmptyState();
  state.orders.push({
    _id: "orders_1",
    _creationTime: 1,
    orderRef,
    channel: "online",
    status: options.orderStatus ?? "payment_pending",
    currency: "usd",
    subtotalCents: 6000,
    feeCents: 90,
    totalCents: 6090,
    expectedProvider: "stripe",
    idempotencyKey: "acc_checkout_test",
    createdAt: 1,
    updatedAt: 1
  });
  state.paymentEvents.push({
    _id: "paymentEvents_1",
    _creationTime: 1,
    orderRef,
    provider: "stripe",
    providerPaymentId: checkoutProviderPaymentId,
    idempotencyKey: "skyla:checkout-session:ORD260704-ABC123",
    status: "created",
    currency: "usd",
    amountCents: 6090,
    createdAt: 1
  });
  if (options.includePaidEvent) {
    state.paymentEvents.push({
      _id: "paymentEvents_2",
      _creationTime: 1,
      orderRef,
      provider: "stripe",
      providerPaymentId: checkoutProviderPaymentId,
      idempotencyKey: "skyla:checkout-session:ORD260704-ABC123",
      status: "paid",
      currency: "usd",
      amountCents: 6090,
      rawEventId: "evt_checkout_paid_original",
      createdAt: 1
    });
  }

  return createMockCtx(state);
}

function createTerminalWebhookCtx(
  options: { saleStatus?: string; terminalStatus?: string } = {}
): { ctx: MockCtx; state: MockState } {
  const state = createEmptyState();
  state.posSales.push(
      {
        _id: "posSales_1",
        _creationTime: 1,
        saleRef,
        status: options.saleStatus ?? "payment_pending",
        currency: "usd",
        subtotalCents: 4200,
        feeCents: 0,
        totalCents: 4200,
        createdAt: 1,
        updatedAt: 1
      }
  );
  state.paymentEvents.push(
      {
        _id: "paymentEvents_1",
        _creationTime: 1,
        saleRef,
        provider: "terminal",
        providerPaymentId,
        idempotencyKey: stripeTerminalIntentIdempotencyKey(saleRef),
        status: options.terminalStatus ?? "processing",
        currency: "usd",
        amountCents: 4200,
        createdAt: 1
      }
  );

  return createMockCtx(state);
}

function createEmptyState(): MockState {
  return {
    orders: [],
    posSales: [],
    paymentEvents: [],
    webhookEvents: [],
    auditEvents: []
  };
}

function createMockCtx(state: MockState): { ctx: MockCtx; state: MockState } {
  let nextId = 2;

  const ctx: MockCtx = {
    db: {
      query(table) {
        return {
          withIndex(_indexName, buildQuery) {
            const filters: Array<{ field: string; value: unknown }> = [];
            const query = {
              eq(field: string, value: unknown) {
                filters.push({ field, value });
                return query;
              }
            };
            buildQuery(query);
            const collect = async () =>
              state[table].filter((doc) => filters.every((filter) => doc[filter.field] === filter.value));
            return {
              async first() {
                const results = await collect();
                return results[0];
              },
              async unique() {
                const results = await collect();
                if (results.length > 1) {
                  throw new Error(`Expected unique ${table} query, found ${results.length}`);
                }
                return results[0];
              },
              collect
            };
          }
        };
      },
      async insert(table, doc) {
        const inserted = {
          ...doc,
          _id: `${table}_${nextId++}`,
          _creationTime: Date.now()
        };
        state[table].push(inserted);
        return inserted._id;
      },
      async patch(id, update) {
        for (const docs of Object.values(state)) {
          const doc = docs.find((candidate) => candidate._id === id);
          if (doc) {
            Object.assign(doc, update);
            return;
          }
        }
        throw new Error(`Mock document not found: ${id}`);
      }
    }
  };

  return { ctx, state };
}
