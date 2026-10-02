import { describe, expect, it, vi } from "vitest";

import { createConvexHarness } from "./convexHarness.testkit";
import { buildCheckoutDraftWrite } from "./lib/orderDraftPersistence";
import { buildTicketDeliveryRecord, normalizeTicketCode } from "./lib/ticketDelivery";
import {
  claimTicketDelivery,
  getTicket,
  recordTicketDeliveryFailure,
  recordTicketDeliverySent,
  requestTicketResend,
  sendTicketConfirmation
} from "./ticketDelivery";

declare const process: { env: Record<string, string | undefined> };

type TableName =
  | "staffUsers"
  | "ticketDeliveries"
  | "bookings"
  | "auditEvents"
  | "orders"
  | "orderLineItems"
  | "paymentEvents"
  | "refunds"
  | "posSales"
  | "operationsExceptions";
type Doc = Record<string, unknown> & { _id: string };

function handler<TArgs, TResult>(value: unknown) {
  return (value as { _handler: (ctx: ReturnType<typeof createCtx>["ctx"], args: TArgs) => Promise<TResult> })._handler;
}

function createCtx(options: {
  role?: "admin" | "pos" | "viewer";
  delivery?: Partial<Doc>;
  booking?: Partial<Doc>;
  includeBooking?: boolean;
  orderStatus?: string;
} = {}) {
  const subject = "staff_subject_123";
  const built = buildCheckoutDraftWrite({
    packageKey: "general", adults: 1, children: 1, freeChildren: 1,
    visitDate: "2026-08-14", entryTime: "19:00", customerEmail: "guest@example.com",
    idempotencyKey: "ticket_delivery_fixture"
  }, { orderRef: "ORDER-1", now: 10 });
  const state: Record<TableName, Doc[]> = {
    staffUsers: [
      {
        _id: "staffUsers_1",
        subject,
        emailLower: "ops@example.com",
        role: options.role ?? "admin",
        active: true,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    ticketDeliveries: [
      {
        _id: "ticketDeliveries_1",
        ticketCode: "tkt_0123456789abcdef0123456789abcdef",
        bookingRef: "BOOKING-1",
        orderRef: "ORDER-1",
        emailLower: "guest@example.com",
        status: "queued",
        attemptCount: 0,
        sendVersion: 1,
        createdAt: 10,
        updatedAt: 10,
        ...options.delivery
      }
    ],
    bookings:
      options.includeBooking === false
        ? []
        : [
            {
              _id: "bookings_1",
              bookingRef: "BOOKING-1",
              orderRef: "ORDER-1",
              status: "confirmed",
              visitDate: "2026-08-14",
              entryTime: "19:00",
              partySize: 3,
              createdAt: 10,
              ...options.booking
            }
          ],
    auditEvents: [],
    orders: [{ ...built.order, _id: "orders_1", status: options.orderStatus ?? "paid" }],
    orderLineItems: built.lines.map((line, index) => ({ ...line, _id: `orderLineItems_${index + 1}` })),
    paymentEvents: [{
      _id: "paymentEvents_1", orderRef: "ORDER-1", provider: "stripe",
      providerPaymentId: "cs_test_ticket_delivery_fixture", providerPaymentIntentId: "pi_ticket_delivery_fixture",
      status: "paid", amountCents: built.order.totalCents, currency: "usd", createdAt: 10
    }],
    refunds: [],
    posSales: [],
    operationsExceptions: []
  };
  const scheduled: Array<{ delayMs: number; args: Record<string, unknown> }> = [];
  // Share the harness's index ordering, bounded reads and patch semantics;
  // retain stable IDs used by these focused lifecycle assertions.
  const harness = createConvexHarness({});
  for (const table of Object.keys(state) as TableName[]) {
    harness.rows(table).push(...state[table].map(doc => ({ _creationTime: 1, ...doc })));
    state[table] = harness.rows(table);
  }

  const ctx = {
    auth: {
      async getUserIdentity() {
        return { subject };
      }
    },
    db: harness.ctx.db,
    scheduler: {
      async runAt(at: number, _reference: unknown, args: Record<string, unknown>) {
        scheduled.push({ delayMs: at - Date.now(), args });
      },
      async runAfter(delayMs: number, _reference: unknown, args: Record<string, unknown>) {
        scheduled.push({ delayMs, args });
      }
    }
  };

  return { ctx, state, scheduled };
}

describe("ticket delivery records", () => {
  it("queues idempotent email delivery state for a booking", () => {
    expect(
      buildTicketDeliveryRecord(
        {
          ticketCode: "TKT_0123456789ABCDEF0123456789ABCDEF",
          bookingRef: "BOOKING-1",
          orderRef: "ORDER-1",
          emailLower: "Guest@Example.com"
        },
        123
      )
    ).toEqual({
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      bookingRef: "BOOKING-1",
      orderRef: "ORDER-1",
      emailLower: "guest@example.com",
      status: "queued",
      attemptCount: 0,
      sendVersion: 1,
      createdAt: 123,
      updatedAt: 123
    });
  });

  it("suppresses email delivery when a POS ticket has no email", () => {
    expect(
      buildTicketDeliveryRecord(
        {
          ticketCode: "tkt_0123456789abcdef0123456789abcdef",
          bookingRef: "SALE-1",
          saleRef: "SALE-1"
        },
        456
      )
    ).toMatchObject({
      status: "suppressed",
      failureReason: "customer_email_missing",
      sendVersion: 1
    });
  });

  it("rejects malformed ticket codes", () => {
    expect(() => normalizeTicketCode("ticket-guessable")).toThrow("ticketCode is invalid");
  });
});

describe("ticket delivery lifecycle", () => {
  it("returns a cancelled booking state so ticket and QR callers fail closed", async () => {
    const { ctx } = createCtx({ booking: { status: "cancelled", cancelledAt: 20, updatedAt: 20 } });
    const lookup = handler<{ ticketCode: string }, { status: string }>(getTicket);

    await expect(
      lookup(ctx, { ticketCode: "tkt_0123456789abcdef0123456789abcdef" })
    ).resolves.toMatchObject({ bookingRef: "BOOKING-1", status: "cancelled" });
  });

  it("claims a queued delivery exactly once during its sending lease", async () => {
    const { ctx, state } = createCtx();
    const claim = handler<{ deliveryId: string }, { attemptCount: number } | null>(claimTicketDelivery);

    await expect(claim(ctx, { deliveryId: "ticketDeliveries_1" })).resolves.toMatchObject({
      bookingRef: "BOOKING-1",
      emailLower: "guest@example.com",
      attemptCount: 1,
      sendVersion: 1
    });
    await expect(claim(ctx, { deliveryId: "ticketDeliveries_1" })).resolves.toBeNull();
    expect(state.ticketDeliveries[0]).toMatchObject({ status: "sending", attemptCount: 1 });
  });

  it("suppresses missing-email delivery without an outbound attempt", async () => {
    const { ctx, state } = createCtx({ delivery: { emailLower: undefined } });

    await expect(
      handler<{ deliveryId: string }, unknown>(claimTicketDelivery)(ctx, { deliveryId: "ticketDeliveries_1" })
    ).resolves.toBeNull();
    expect(state.ticketDeliveries[0]).toMatchObject({
      status: "suppressed",
      attemptCount: 0,
      failureReason: "customer_email_missing"
    });
  });

  it("records a missing booking as a delivery failure", async () => {
    const { ctx, state } = createCtx({ includeBooking: false });

    await expect(
      handler<{ deliveryId: string }, unknown>(claimTicketDelivery)(ctx, { deliveryId: "ticketDeliveries_1" })
    ).resolves.toBeNull();
    expect(state.ticketDeliveries[0]).toMatchObject({ status: "failed", failureReason: "booking_missing" });
  });

  it("suppresses a queued delivery after its booking is cancelled", async () => {
    const { ctx, state } = createCtx({ booking: { status: "cancelled", cancelledAt: 20, updatedAt: 20 } });

    await expect(
      handler<{ deliveryId: string }, unknown>(claimTicketDelivery)(ctx, { deliveryId: "ticketDeliveries_1" })
    ).resolves.toBeNull();
    expect(state.ticketDeliveries[0]).toMatchObject({
      status: "suppressed",
      attemptCount: 0,
      failureReason: "booking_cancelled"
    });
  });

  it("records sent and failed provider outcomes without exposing provider details in the audit reference", async () => {
    const sentCtx = createCtx({ delivery: { status: "sending", attemptCount: 1 } });
    await handler<
      { deliveryId: string; providerMessageId: string; attemptCount: number; sendVersion: number },
      null
    >(recordTicketDeliverySent)(sentCtx.ctx, {
      deliveryId: "ticketDeliveries_1",
      providerMessageId: "resend_message_123",
      attemptCount: 1,
      sendVersion: 1
    });
    expect(sentCtx.state.ticketDeliveries[0]).toMatchObject({
      status: "sent",
      providerMessageId: "resend_message_123",
      sentAt: expect.any(Number)
    });
    expect(sentCtx.state.auditEvents[0]).toMatchObject({
      action: "ticket.deliverySent",
      entityRef: "BOOKING-1"
    });
    expect(JSON.stringify(sentCtx.state.auditEvents[0])).not.toContain("resend_message_123");

    const failedCtx = createCtx({ delivery: { status: "sending", attemptCount: 1 } });
    await handler<
      { deliveryId: string; failureReason: string; attemptCount: number; sendVersion: number },
      null
    >(recordTicketDeliveryFailure)(failedCtx.ctx, {
      deliveryId: "ticketDeliveries_1",
      failureReason: "email_provider_503",
      attemptCount: 1,
      sendVersion: 1
    });
    expect(failedCtx.state.ticketDeliveries[0]).toMatchObject({
      status: "failed",
      failureReason: "email_provider_503"
    });
    expect(failedCtx.state.auditEvents[0]).toMatchObject({ action: "ticket.deliveryFailed" });
  });

  it("ignores completion from an obsolete claim", async () => {
    const delivery = createCtx({
      delivery: { status: "sending", attemptCount: 2, sendVersion: 3, lastAttemptAt: Date.now() }
    });
    const recordSent = handler<
      { deliveryId: string; providerMessageId: string; attemptCount: number; sendVersion: number },
      null
    >(recordTicketDeliverySent);

    await recordSent(delivery.ctx, {
      deliveryId: "ticketDeliveries_1",
      providerMessageId: "obsolete_message",
      attemptCount: 1,
      sendVersion: 3
    });

    expect(delivery.state.ticketDeliveries[0]).toMatchObject({ status: "sending", attemptCount: 2 });
    expect(delivery.state.auditEvents).toHaveLength(0);
  });

  it("allows only admins to requeue a delivery and records the request", async () => {
    const viewer = createCtx({ role: "viewer", delivery: { status: "failed", failureReason: "email_provider_503" } });
    const resend = handler<
      { bookingRef: string },
      {
        status: string;
        sendVersion: number;
        failureReason?: string;
        lastAttemptAt?: number;
        sentAt?: number;
      }
    >(requestTicketResend);
    await expect(resend(viewer.ctx, { bookingRef: "BOOKING-1" })).rejects.toThrow(
      "Staff role must be one of: admin"
    );

    const admin = createCtx({
      delivery: {
        status: "failed",
        failureReason: "email_provider_503",
        lastAttemptAt: 100,
        sentAt: 90
      }
    });
    const result = await resend(admin.ctx, { bookingRef: "BOOKING-1" });
    expect(result).toMatchObject({
      status: "queued",
      sendVersion: 2
    });
    expect(result.failureReason).toBeUndefined();
    expect(result.lastAttemptAt).toBeUndefined();
    expect(result.sentAt).toBeUndefined();
    expect(admin.state.ticketDeliveries[0]).toMatchObject({
      status: "queued",
      sendVersion: 2
    });
    expect(admin.state.ticketDeliveries[0]).not.toHaveProperty("failureReason");
    expect(admin.scheduled).toEqual([
      { delayMs: 0, args: { deliveryId: "ticketDeliveries_1" } }
    ]);
    expect(admin.state.auditEvents[0]).toMatchObject({
      actorStaffUserId: "staffUsers_1",
      action: "ticket.deliveryResendRequested",
      entityRef: "BOOKING-1"
    });
  });

  it("rejects an admin resend for a cancelled booking", async () => {
    const admin = createCtx({
      booking: { status: "cancelled", cancelledAt: 20, updatedAt: 20 },
      delivery: { status: "failed", failureReason: "email_provider_503" }
    });
    const resend = handler<{ bookingRef: string }, { status: string; sendVersion: number }>(requestTicketResend);

    await expect(resend(admin.ctx, { bookingRef: "BOOKING-1" })).rejects.toThrow(
      "Cancelled bookings cannot resend tickets"
    );
    expect(admin.state.ticketDeliveries[0]).toMatchObject({
      status: "failed",
      sendVersion: 1,
      failureReason: "email_provider_503"
    });
    expect(admin.scheduled).toHaveLength(0);
  });

  it("recovers an expired sending lease with the same provider idempotency version", async () => {
    const admin = createCtx({
      delivery: { status: "sending", attemptCount: 1, sendVersion: 4, lastAttemptAt: 1 }
    });
    const resend = handler<{ bookingRef: string }, { status: string; sendVersion: number }>(requestTicketResend);

    await expect(resend(admin.ctx, { bookingRef: "BOOKING-1" })).resolves.toMatchObject({
      status: "queued",
      sendVersion: 4
    });
    expect(admin.state.ticketDeliveries[0]).toMatchObject({ status: "queued", sendVersion: 4 });
    expect(admin.state.auditEvents[0]).toMatchObject({
      action: "ticket.deliveryResendRequested",
      metadata: { bookingRef: "BOOKING-1", sendVersion: 4, recovery: true }
    });
  });

  it("retries an unknown provider outcome with the same idempotency version", async () => {
    const admin = createCtx({
      delivery: {
        status: "failed",
        attemptCount: 1,
        sendVersion: 4,
        lastAttemptAt: 100,
        failureReason: "email_delivery_outcome_unknown"
      }
    });
    const resend = handler<{ bookingRef: string }, { status: string; sendVersion: number }>(requestTicketResend);

    await expect(resend(admin.ctx, { bookingRef: "BOOKING-1" })).resolves.toMatchObject({
      status: "queued",
      sendVersion: 4
    });
    expect(admin.state.ticketDeliveries[0]).toMatchObject({
      status: "queued",
      sendVersion: 4
    });
    expect(admin.state.ticketDeliveries[0]).not.toHaveProperty("failureReason");
    expect(admin.state.ticketDeliveries[0]).not.toHaveProperty("lastAttemptAt");
    expect(admin.state.auditEvents[0]).toMatchObject({
      action: "ticket.deliveryResendRequested",
      metadata: {
        bookingRef: "BOOKING-1",
        sendVersion: 4,
        recovery: true,
        recoveryReason: "unknown_provider_outcome"
      }
    });
  });

  it("rejects an admin resend while the active sending lease is still valid", async () => {
    const admin = createCtx({
      delivery: { status: "sending", attemptCount: 1, sendVersion: 4, lastAttemptAt: Date.now() }
    });
    const resend = handler<{ bookingRef: string }, { status: string; sendVersion: number }>(requestTicketResend);

    await expect(resend(admin.ctx, { bookingRef: "BOOKING-1" })).rejects.toThrow(
      "Ticket delivery is already sending"
    );
    expect(admin.scheduled).toHaveLength(0);
  });

  it("records an unknown provider outcome against the active claim", async () => {
    const original = {
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.SKYLA_TICKET_FROM_EMAIL,
      origin: process.env.SKYLA_PUBLIC_ORIGIN
    };
    process.env.RESEND_API_KEY = "re_test";
    process.env.SKYLA_TICKET_FROM_EMAIL = "tickets@example.com";
    process.env.SKYLA_PUBLIC_ORIGIN = "https://skydeckla.com";
    // The provider may have accepted the email before the connection dropped.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("connection reset");
    }));

    const calls: Array<Record<string, unknown>> = [];
    const payload = {
      deliveryId: "ticketDeliveries_1",
      ticketCode: "tkt_0123456789abcdef0123456789abcdef",
      bookingRef: "BOOKING-1",
      emailLower: "guest@example.com",
      attemptCount: 2,
      sendVersion: 3
    };
    const action = (sendTicketConfirmation as unknown as {
      _handler: (
        ctx: { runMutation: (_reference: unknown, args: Record<string, unknown>) => Promise<unknown> },
        args: { deliveryId: string }
      ) => Promise<null>;
    })._handler;

    try {
      const result = await action(
        {
          async runMutation(_reference, args) {
            calls.push(args);
            return calls.length === 1 ? payload : null;
          }
        },
        { deliveryId: "ticketDeliveries_1" }
      );

      expect(result).toBeNull();
      expect(calls).toEqual([
        { deliveryId: "ticketDeliveries_1", providerConfigurationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
        {
          deliveryId: "ticketDeliveries_1",
          failureReason: "email_delivery_outcome_unknown",
          attemptCount: 2,
          sendVersion: 3
        }
      ]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv("RESEND_API_KEY", original.apiKey);
      restoreEnv("SKYLA_TICKET_FROM_EMAIL", original.from);
      restoreEnv("SKYLA_PUBLIC_ORIGIN", original.origin);
    }
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
