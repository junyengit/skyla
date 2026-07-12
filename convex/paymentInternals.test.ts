import { describe, expect, it } from "vitest";
import { catalogLineMetadata, cafeItems, ticketPackages } from "@skyla/payments";

import { stripeTerminalIntentIdempotencyKey } from "./lib/stripeTerminal";
import {
  getCheckoutPaymentSnapshot,
  getPosTerminalPaymentSnapshot,
  getStripeTerminalReaderProcessSnapshot,
  recordStripeCheckoutWebhook,
  recordStripeRefundWebhook,
  recordStripeTerminalWebhook
} from "./paymentInternals";

type TableName =
  | "orders"
  | "orderLineItems"
  | "posSales"
  | "posSaleLines"
  | "paymentEvents"
  | "refunds"
  | "webhookEvents"
  | "bookings"
  | "auditEvents"
  | "staffUsers";
type MockDoc = Record<string, unknown> & { _id: string; _creationTime: number };
type MockState = Record<TableName, MockDoc[]>;
type MockCtx = {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
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
  providerPaymentIntentId?: string;
  orderRef?: string;
  amountCents?: number;
  currency?: "usd";
  raw?: Record<string, unknown>;
};
type RefundWebhookArgs = {
  providerEventId: string;
  eventType: string;
  outcome: "refund" | "ignored";
  providerRefundId?: string;
  providerPaymentIntentId?: string;
  refundStatus?: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  amountCents?: number;
  currency?: "usd";
  reason?: string;
  failureReason?: string;
  providerEventCreatedAt?: number;
  raw?: Record<string, unknown>;
};
type CheckoutWebhookResult = {
  status: "processed" | "ignored" | "failed";
  duplicate: boolean;
  orderRef?: string;
};

const orderRef = "ORD260704-ABC123";
const saleRef = "SALE260704-ABC123";
const checkoutVisitDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const providerPaymentId = "pi_terminal_123";
const checkoutProviderPaymentId = "cs_test_123";
const checkoutPaymentIntentId = "pi_checkout_123";

declare const process: { env: Record<string, string | undefined> };

describe("payment snapshot provenance gates", () => {
  it("rejects Checkout payment snapshots whose catalog line provenance disappeared", async () => {
    const { ctx } = createCheckoutSnapshotCtx({
      lineMetadata: undefined
    });

    await expect(
      runCheckoutPaymentSnapshot(ctx, {
        orderRef,
        idempotencyKey: "acc_checkout_test"
      })
    ).rejects.toThrow("Checkout line 1 is missing catalog provenance metadata");
  });

  it("returns Checkout payment snapshots when stored catalog provenance is intact", async () => {
    const { ctx } = createCheckoutSnapshotCtx();

    await expect(
      runCheckoutPaymentSnapshot(ctx, {
        orderRef,
        idempotencyKey: "acc_checkout_test"
      })
    ).resolves.toMatchObject({
      orderRef,
      totalCents: 6090,
      lines: [
        {
          name: "General Admission",
          quantity: 2,
          unitAmountCents: 2900,
          lineTotalCents: 5800
        }
      ]
    });
  });

  it.each([
    ["customer email", { customerEmailLower: undefined }, "customerEmailLower is required"],
    ["visit date", { visitDate: undefined }, "visitDate is required"],
    ["entry time", { entryTime: undefined }, "entryTime is required"],
    ["ticket line", { lineKind: "custom", lineMetadata: { reason: "test fixture" } }, "requires at least one ticket line"]
  ])("rejects Checkout payment snapshots without a fulfillment-ready %s", async (_label, options, message) => {
    const { ctx } = createCheckoutSnapshotCtx(options);

    await expect(
      runCheckoutPaymentSnapshot(ctx, {
        orderRef,
        idempotencyKey: "acc_checkout_test"
      })
    ).rejects.toThrow(message);
  });

  it("rejects Terminal reader processing when stored POS line provenance is spoofed", async () => {
    const { ctx } = createTerminalProcessSnapshotCtx({
      lineMetadata: {
        ...catalogLineMetadata(cafeItems.b1),
        catalogContentHash: "fnv1a32:00000000:102"
      }
    });
    const previousRegistry = process.env.SKYLA_TERMINAL_READER_REGISTRY;
    process.env.SKYLA_TERMINAL_READER_REGISTRY = "tmr_test_123@tml_test_123";
    try {
      await expect(
        runTerminalReaderProcessSnapshot(ctx, {
          saleRef,
          idempotencyKey: "possale_000001"
        })
      ).rejects.toThrow("POS Terminal reader process line 1 has mismatched catalog provenance: catalogContentHash");
    } finally {
      process.env.SKYLA_TERMINAL_READER_REGISTRY = previousRegistry;
    }
  });

  it("rejects Terminal PaymentIntent snapshots before Stripe when no reader is stored", async () => {
    const { ctx } = createTerminalPaymentSnapshotCtx({ readerId: undefined });

    await expect(
      runTerminalPaymentSnapshot(ctx, {
        saleRef,
        idempotencyKey: "possale_000001"
      })
    ).rejects.toThrow("POS sale does not have a stored Terminal reader");
  });
});

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
    expect(state.bookings).toHaveLength(1);
    expect(state.bookings[0]).toMatchObject({
      bookingRef: orderRef,
      orderRef,
      visitDate: checkoutVisitDate,
      entryTime: "14:00",
      partySize: 2,
      status: "confirmed",
      emailLower: "guest@example.com"
    });
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({
      action: "checkout.bookingFulfilled",
      entityType: "booking",
      entityRef: orderRef
    });
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
    expect(state.bookings).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
  });

  it("does not duplicate fulfillment when Stripe delivers a second paid event id", async () => {
    const { ctx, state } = createCheckoutWebhookCtx();

    await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_paid_first",
      eventType: "checkout.session.completed",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd"
    });
    const secondResult = await runCheckoutWebhook(ctx, {
      providerEventId: "evt_checkout_paid_second",
      eventType: "checkout.session.async_payment_succeeded",
      outcome: "paid",
      providerPaymentId: checkoutProviderPaymentId,
      orderRef,
      amountCents: 6090,
      currency: "usd"
    });

    expect(secondResult).toEqual({ status: "processed", duplicate: false, orderRef });
    expect(state.bookings).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
    expect(state.paymentEvents.filter((event) => event.status === "paid")).toHaveLength(1);
    expect(state.webhookEvents).toHaveLength(2);
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
    expect(state.bookings).toHaveLength(0);
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

describe("Stripe refund webhook internals", () => {
  it("records a partial Checkout refund without changing fulfillment state", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    const result = await runRefundWebhook(ctx, refundArgs());

    expect(result).toMatchObject({ status: "processed", duplicate: false, orderRef });
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0]).toMatchObject({
      providerRefundId: "re_checkout_1",
      providerPaymentIntentId: checkoutPaymentIntentId,
      paymentProvider: "stripe",
      orderRef,
      status: "succeeded",
      amountCents: 2000
    });
    expect(state.orders[0].status).toBe("paid");
    expect(state.webhookEvents[0]).toMatchObject({ providerEventId: "evt_refund_1", status: "processed", orderRef });
    expect(state.auditEvents[0]).toMatchObject({ action: "payment.refund.reconciled", entityRef: orderRef });
  });

  it("is replay-safe and updates the same refund from pending to succeeded", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    const pending = refundArgs({ refundStatus: "pending", providerEventId: "evt_refund_pending" });
    const first = await runRefundWebhook(ctx, pending);
    const replay = await runRefundWebhook(ctx, pending);
    const succeeded = await runRefundWebhook(
      ctx,
      refundArgs({ providerEventId: "evt_refund_succeeded", providerEventCreatedAt: 3000 })
    );

    expect(first).toMatchObject({ status: "processed", duplicate: false });
    expect(replay).toMatchObject({ status: "processed", duplicate: true });
    expect(succeeded).toMatchObject({ status: "processed", duplicate: false, stale: false });
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0].status).toBe("succeeded");
    expect(state.webhookEvents).toHaveLength(2);
  });

  it("rejects cumulative successful refunds above the original paid amount", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs({ amountCents: 5000 }));
    const second = await runRefundWebhook(
      ctx,
      refundArgs({
        providerEventId: "evt_refund_2",
        providerRefundId: "re_checkout_2",
        providerEventCreatedAt: 3000,
        amountCents: 2000
      })
    );

    expect(second).toMatchObject({ status: "failed", duplicate: false, orderRef });
    expect(state.refunds).toHaveLength(1);
    expect(state.webhookEvents[1].raw).toMatchObject({ reason: "cumulative_refund_exceeds_payment" });
  });

  it("ignores an older refund update without regressing the stored status", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs({ providerEventCreatedAt: 5000 }));
    const stale = await runRefundWebhook(
      ctx,
      refundArgs({ providerEventId: "evt_refund_stale", refundStatus: "pending", providerEventCreatedAt: 4000 })
    );

    expect(stale).toMatchObject({ status: "processed", stale: true });
    expect(state.refunds[0].status).toBe("succeeded");
    expect(state.auditEvents).toHaveLength(1);
  });

  it("allows a succeeded refund to fail when Stripe later returns the funds", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs());
    const failed = await runRefundWebhook(
      ctx,
      refundArgs({
        providerEventId: "evt_refund_failed_late",
        refundStatus: "failed",
        failureReason: "declined",
        providerEventCreatedAt: 6000
      })
    );

    expect(failed).toMatchObject({ status: "processed", stale: false });
    expect(state.refunds[0]).toMatchObject({ status: "failed", failureReason: "declined" });
    expect(state.auditEvents).toHaveLength(2);
  });

  it("allows a succeeded refund to require corrected banking details", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs());
    const requiresAction = await runRefundWebhook(
      ctx,
      refundArgs({
        providerEventId: "evt_refund_requires_action_late",
        refundStatus: "requires_action",
        providerEventCreatedAt: 6000
      })
    );

    expect(requiresAction).toMatchObject({ status: "processed", stale: false });
    expect(state.refunds[0].status).toBe("requires_action");
    expect(state.auditEvents).toHaveLength(2);
  });

  it("does not switch a failed refund state even when a newer event disagrees", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs({ refundStatus: "failed", failureReason: "declined" }));
    const conflicting = await runRefundWebhook(
      ctx,
      refundArgs({
        providerEventId: "evt_refund_succeeded_late",
        refundStatus: "succeeded",
        failureReason: undefined,
        providerEventCreatedAt: 6000
      })
    );

    expect(conflicting).toMatchObject({ status: "processed", stale: true });
    expect(state.refunds[0].status).toBe("failed");
    expect(state.auditEvents).toHaveLength(1);
  });

  it("does not regress succeeded to pending even when timestamps tie", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    await runRefundWebhook(ctx, refundArgs());
    const pending = await runRefundWebhook(
      ctx,
      refundArgs({ providerEventId: "evt_refund_pending_late", refundStatus: "pending" })
    );

    expect(pending).toMatchObject({ status: "processed", stale: true });
    expect(state.refunds[0].status).toBe("succeeded");
    expect(state.auditEvents).toHaveLength(1);
  });

  it("fails correlation when the associated order is no longer paid", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "payment_pending", includePaidEvent: true });
    const result = await runRefundWebhook(ctx, refundArgs());

    expect(result).toMatchObject({ status: "failed", orderRef });
    expect(state.refunds).toHaveLength(0);
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "paid_order_not_refundable" });
  });

  it("rejects non-integer refund money before ledger correlation", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: true });
    const result = await runRefundWebhook(ctx, refundArgs({ amountCents: 10.5 }));

    expect(result).toMatchObject({ status: "failed", duplicate: false });
    expect(state.refunds).toHaveLength(0);
    expect(state.webhookEvents[0].raw).toMatchObject({ reason: "missing_refund_fields" });
  });

  it("keeps a refund retryable until its paid PaymentIntent ledger exists", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: false });
    const result = await runRefundWebhook(ctx, refundArgs({ providerEventCreatedAt: Date.now() }));

    expect(result).toMatchObject({
      status: "retryable",
      duplicate: false,
      reason: "paid_payment_intent_not_found"
    });
    expect(state.refunds).toHaveLength(0);
    expect(state.webhookEvents).toHaveLength(0);
  });

  it("durably fails an unknown PaymentIntent after the bounded retry window", async () => {
    const { ctx, state } = createCheckoutWebhookCtx({ orderStatus: "paid", includePaidEvent: false });
    const result = await runRefundWebhook(
      ctx,
      refundArgs({ providerEventCreatedAt: Date.now() - 72 * 60 * 60 * 1000 - 1 })
    );

    expect(result).toMatchObject({ status: "failed", duplicate: false });
    expect(state.refunds).toHaveLength(0);
    expect(state.webhookEvents[0].raw).toMatchObject({
      reason: "paid_payment_intent_not_found_after_retry_window"
    });
  });

  it("correlates Terminal refunds to the paid POS sale", async () => {
    const { ctx, state } = createTerminalWebhookCtx({ saleStatus: "paid", terminalStatus: "paid" });
    const result = await runRefundWebhook(
      ctx,
      refundArgs({ providerPaymentIntentId: providerPaymentId, amountCents: 1000 })
    );

    expect(result).toMatchObject({ status: "processed", saleRef });
    expect(state.refunds[0]).toMatchObject({ paymentProvider: "terminal", saleRef, amountCents: 1000 });
    expect(state.posSales[0].status).toBe("paid");
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
  return mutation._handler(ctx, {
    ...args,
    providerPaymentIntentId:
      args.providerPaymentIntentId ?? (args.outcome === "paid" ? checkoutPaymentIntentId : undefined)
  });
}

async function runRefundWebhook(ctx: MockCtx, args: RefundWebhookArgs) {
  const mutation = recordStripeRefundWebhook as unknown as {
    _handler: (ctx: MockCtx, args: RefundWebhookArgs) => Promise<Record<string, unknown>>;
  };
  return mutation._handler(ctx, args);
}

function refundArgs(overrides: Partial<RefundWebhookArgs> = {}): RefundWebhookArgs {
  return {
    providerEventId: "evt_refund_1",
    eventType: "refund.updated",
    outcome: "refund",
    providerRefundId: "re_checkout_1",
    providerPaymentIntentId: checkoutPaymentIntentId,
    refundStatus: "succeeded",
    amountCents: 2000,
    currency: "usd",
    reason: "requested_by_customer",
    providerEventCreatedAt: 2000,
    raw: { refund: { status: "succeeded" } },
    ...overrides
  };
}

async function runCheckoutPaymentSnapshot(
  ctx: MockCtx,
  args: { orderRef: string; idempotencyKey: string }
) {
  const query = getCheckoutPaymentSnapshot as unknown as {
    _handler: (ctx: MockCtx, args: { orderRef: string; idempotencyKey: string }) => Promise<unknown>;
  };
  return query._handler(ctx, args);
}

async function runTerminalPaymentSnapshot(
  ctx: MockCtx,
  args: { saleRef: string; idempotencyKey: string }
) {
  const query = getPosTerminalPaymentSnapshot as unknown as {
    _handler: (ctx: MockCtx, args: { saleRef: string; idempotencyKey: string }) => Promise<unknown>;
  };
  return query._handler(ctx, args);
}

async function runTerminalReaderProcessSnapshot(
  ctx: MockCtx,
  args: { saleRef: string; idempotencyKey: string }
) {
  const query = getStripeTerminalReaderProcessSnapshot as unknown as {
    _handler: (ctx: MockCtx, args: { saleRef: string; idempotencyKey: string }) => Promise<unknown>;
  };
  return query._handler(ctx, args);
}

function createCheckoutSnapshotCtx(
  options: {
    lineMetadata?: Record<string, string | number | boolean>;
    customerEmailLower?: string;
    visitDate?: string;
    entryTime?: string;
    lineKind?: string;
  } = {}
): { ctx: MockCtx; state: MockState } {
  const state = createEmptyState();
  state.orders.push({
    _id: "orders_1",
    _creationTime: 1,
    orderRef,
    channel: "online",
    status: "draft",
    currency: "usd",
    subtotalCents: 5800,
    feeCents: 290,
    totalCents: 6090,
    customerEmailLower: "customerEmailLower" in options ? options.customerEmailLower : "guest@example.com",
    visitDate: "visitDate" in options ? options.visitDate : checkoutVisitDate,
    entryTime: "entryTime" in options ? options.entryTime : "14:00",
    idempotencyKey: "acc_checkout_test",
    createdAt: 1,
    updatedAt: 1
  });
  state.orderLineItems.push({
    _id: "orderLineItems_1",
    _creationTime: 1,
    orderRef,
    kind: options.lineKind ?? "ticket",
    productKey: "general",
    name: "General Admission",
    quantity: 2,
    unitAmountCents: 2900,
    lineTotalCents: 5800,
    ...(options.lineMetadata === undefined
      ? {}
      : { metadata: options.lineMetadata ?? catalogLineMetadata(ticketPackages.general) })
  });

  if (!("lineMetadata" in options)) {
    state.orderLineItems[0].metadata = catalogLineMetadata(ticketPackages.general);
  }

  return createMockCtx(state);
}

function createTerminalPaymentSnapshotCtx(
  options: { readerId?: string; terminalLocationId?: string } = {}
): { ctx: MockCtx; state: MockState } {
  const state = createEmptyState();
  state.staffUsers.push({
    _id: "staffUsers_1",
    _creationTime: 1,
    subject: "staff_subject",
    emailLower: "pos@example.com",
    role: "pos",
    active: true,
    createdAt: 1,
    updatedAt: 1
  });
  state.posSales.push({
    _id: "posSales_1",
    _creationTime: 1,
    saleRef,
    status: "draft",
    currency: "usd",
    subtotalCents: 600,
    feeCents: 0,
    totalCents: 600,
    staffUserId: "staffUsers_1",
    readerId: options.readerId,
    terminalLocationId: options.terminalLocationId,
    idempotencyKey: "possale_000001",
    createdAt: 1,
    updatedAt: 1
  });
  state.posSaleLines.push({
    _id: "posSaleLines_1",
    _creationTime: 1,
    saleRef,
    kind: "cafe",
    productKey: "b1",
    name: "Butter Croissant",
    quantity: 1,
    unitAmountCents: 600,
    lineTotalCents: 600,
    metadata: catalogLineMetadata(cafeItems.b1)
  });

  return createMockCtx(state);
}

function createTerminalProcessSnapshotCtx(
  options: { lineMetadata?: Record<string, string | number | boolean> } = {}
): { ctx: MockCtx; state: MockState } {
  const state = createEmptyState();
  state.staffUsers.push({
    _id: "staffUsers_1",
    _creationTime: 1,
    subject: "staff_subject",
    emailLower: "pos@example.com",
    role: "pos",
    active: true,
    createdAt: 1,
    updatedAt: 1
  });
  state.posSales.push({
    _id: "posSales_1",
    _creationTime: 1,
    saleRef,
    status: "payment_pending",
    currency: "usd",
    subtotalCents: 600,
    feeCents: 0,
    totalCents: 600,
    staffUserId: "staffUsers_1",
    readerId: "tmr_test_123",
    terminalLocationId: "tml_test_123",
    idempotencyKey: "possale_000001",
    createdAt: 1,
    updatedAt: 1
  });
  state.posSaleLines.push({
    _id: "posSaleLines_1",
    _creationTime: 1,
    saleRef,
    kind: "cafe",
    productKey: "b1",
    name: "Butter Croissant",
    quantity: 1,
    unitAmountCents: 600,
    lineTotalCents: 600,
    metadata: options.lineMetadata ?? catalogLineMetadata(cafeItems.b1)
  });
  state.paymentEvents.push({
    _id: "paymentEvents_1",
    _creationTime: 1,
    saleRef,
    provider: "terminal",
    providerPaymentId,
    idempotencyKey: stripeTerminalIntentIdempotencyKey(saleRef),
    status: "requires_payment",
    currency: "usd",
    amountCents: 600,
    createdAt: 1
  });

  return createMockCtx(state);
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
    customerEmailLower: "guest@example.com",
    visitDate: checkoutVisitDate,
    entryTime: "14:00",
    idempotencyKey: "acc_checkout_test",
    createdAt: 1,
    updatedAt: 1
  });
  state.orderLineItems.push({
    _id: "orderLineItems_1",
    _creationTime: 1,
    orderRef,
    kind: "ticket",
    productKey: "general",
    name: "General Admission",
    quantity: 2,
    unitAmountCents: 2900,
    lineTotalCents: 5800,
    metadata: catalogLineMetadata(ticketPackages.general)
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
      providerPaymentIntentId: checkoutPaymentIntentId,
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
        providerPaymentIntentId: providerPaymentId,
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
    orderLineItems: [],
    posSales: [],
    posSaleLines: [],
    paymentEvents: [],
    refunds: [],
    webhookEvents: [],
    bookings: [],
    auditEvents: [],
    staffUsers: []
  };
}

function createMockCtx(state: MockState): { ctx: MockCtx; state: MockState } {
  let nextId = 2;

  const ctx: MockCtx = {
    auth: {
      async getUserIdentity() {
        return { subject: "staff_subject" };
      }
    },
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
