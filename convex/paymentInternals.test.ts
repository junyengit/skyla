import { describe, expect, it } from "vitest";

import { stripeTerminalIntentIdempotencyKey } from "./lib/stripeTerminal";
import { recordStripeTerminalWebhook } from "./paymentInternals";

type TableName = "posSales" | "paymentEvents" | "webhookEvents" | "auditEvents";
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

const saleRef = "SALE260704-ABC123";
const providerPaymentId = "pi_terminal_123";

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

function createTerminalWebhookCtx(
  options: { saleStatus?: string; terminalStatus?: string } = {}
): { ctx: MockCtx; state: MockState } {
  const state: MockState = {
    posSales: [
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
    ],
    paymentEvents: [
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
    ],
    webhookEvents: [],
    auditEvents: []
  };
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
