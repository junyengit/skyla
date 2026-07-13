import { describe, expect, it } from "vitest";

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

type TableName = "staffUsers" | "ticketDeliveries" | "bookings" | "auditEvents";
type Doc = Record<string, unknown> & { _id: string };

function handler<TArgs, TResult>(value: unknown) {
  return (value as { _handler: (ctx: ReturnType<typeof createCtx>["ctx"], args: TArgs) => Promise<TResult> })._handler;
}

function createCtx(options: {
  role?: "admin" | "pos" | "viewer";
  delivery?: Partial<Doc>;
  booking?: Partial<Doc>;
  includeBooking?: boolean;
} = {}) {
  const subject = "staff_subject_123";
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
              status: "confirmed",
              visitDate: "2026-08-14",
              entryTime: "19:00",
              partySize: 2,
              createdAt: 10,
              ...options.booking
            }
          ],
    auditEvents: []
  };
  const scheduled: Array<{ delayMs: number; args: Record<string, unknown> }> = [];

  const ctx = {
    auth: {
      async getUserIdentity() {
        return { subject };
      }
    },
    db: {
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            build?: (query: { eq: (field: string, value: unknown) => unknown }) => unknown
          ) {
            const filters: Array<{ field: string; value: unknown }> = [];
            const query = {
              eq(field: string, value: unknown) {
                filters.push({ field, value });
                return query;
              }
            };
            build?.(query);
            return {
              async unique() {
                const matches = state[table].filter((doc) =>
                  filters.every(({ field, value }) => doc[field] === value)
                );
                if (matches.length > 1) throw new Error("Expected unique result");
                return matches[0] ?? null;
              }
            };
          }
        };
      },
      async get(id: string) {
        return Object.values(state)
          .flat()
          .find((doc) => doc._id === id) ?? null;
      },
      async patch(id: string, value: Record<string, unknown>) {
        const doc = Object.values(state)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!doc) throw new Error(`Missing ${id}`);
        Object.assign(doc, value);
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        const doc = { ...value, _id: `${table}_${state[table].length + 1}` };
        state[table].push(doc);
        return doc._id;
      }
    },
    scheduler: {
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
      sendVersion: 2,
      failureReason: undefined
    });
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
      sendVersion: 4,
      failureReason: undefined,
      lastAttemptAt: undefined
    });
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
    delete process.env.SKYLA_PUBLIC_ORIGIN;

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
        { deliveryId: "ticketDeliveries_1" },
        {
          deliveryId: "ticketDeliveries_1",
          failureReason: "email_delivery_outcome_unknown",
          attemptCount: 2,
          sendVersion: 3
        }
      ]);
    } finally {
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
