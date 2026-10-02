import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConvexHarness, createFakeResend, type ConvexHarness } from "./convexHarness.testkit";
import * as ticketDelivery from "./ticketDelivery";
import { providerConfigurationFingerprint } from "./lib/providerIdentity";

declare const process: { env: Record<string, string | undefined> };

const now0 = Date.parse("2026-10-02T19:00:00.000Z");
const minute = 60 * 1000;
const hour = 60 * minute;
const ticketCode = "tkt_0123456789abcdef0123456789abcdef";
const sendJob = "ticketDelivery:sendTicketConfirmation";
let sendingFingerprint: string;

function setup(options: { orderStatus?: string; bookingStatus?: string; delivery?: Record<string, unknown> } = {}) {
  const harness = createConvexHarness({ ticketDelivery });
  const resend = createFakeResend();
  const fetchMock = vi.fn(resend.fetch);
  vi.stubGlobal("fetch", fetchMock);
  harness.seed("orders", { orderRef: "ORDER-1", channel: "online", status: options.orderStatus ?? "paid" });
  harness.seed("bookings", {
    bookingRef: "ORDER-1",
    orderRef: "ORDER-1",
    visitDate: "2026-10-03",
    entryTime: "14:00",
    partySize: 2,
    status: options.bookingStatus ?? "confirmed",
    emailLower: "guest@example.com",
    createdAt: now0
  });
  const deliveryId = harness.seed("ticketDeliveries", {
    ticketCode,
    bookingRef: "ORDER-1",
    orderRef: "ORDER-1",
    emailLower: "guest@example.com",
    status: "queued",
    attemptCount: 0,
    sendVersion: 1,
    createdAt: now0,
    updatedAt: now0,
    ...(options.delivery?.providerKeyFirstUsedAt !== undefined ? { providerConfigurationFingerprint: sendingFingerprint } : {}),
    ...options.delivery
  });
  return { harness, resend, fetchMock, deliveryId };
}

const delivery = (harness: ConvexHarness) => harness.rows("ticketDeliveries")[0];
const send = (harness: ConvexHarness, deliveryId: string) =>
  harness.runAction(ticketDelivery.sendTicketConfirmation, { deliveryId });
const sendJobs = (harness: ConvexHarness) => harness.runDueJobs((job) => job.name === sendJob);
const openExceptions = (harness: ConvexHarness) =>
  harness.rows("operationsExceptions").filter((row) => row.status === "open");

function configureEmail() {
  process.env.RESEND_API_KEY = "re_test_fixture";
  process.env.SKYLA_TICKET_FROM_EMAIL = "tickets@example.com";
  process.env.SKYLA_PUBLIC_ORIGIN = "https://skydeckla.com";
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now0);
  configureEmail();
  sendingFingerprint = await providerConfigurationFingerprint(["resend", "re_test_fixture", "tickets@example.com", "https://skydeckla.com", "reservations@skydeckla.com"]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.SKYLA_TICKET_FROM_EMAIL;
  delete process.env.SKYLA_PUBLIC_ORIGIN;
});

describe("ticket delivery recovery", () => {
  it("keeps an unknown accepted email for staff when sending credentials change", async () => {
    const { harness, resend, deliveryId } = setup();
    resend.fail("network_after_accept");
    await send(harness, deliveryId);
    vi.setSystemTime(now0 + minute);
    vi.stubEnv("RESEND_API_KEY", "re_other_merchant_fixture");
    await sendJobs(harness);
    expect(resend.calls).toHaveLength(1);
    expect(delivery(harness)).toMatchObject({ status: "failed", failureReason: "email_provider_configuration_changed" });
    expect(delivery(harness).autoRetryAt).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("a paid checked-in party can still receive its original payment confirmation", async () => {
    const { harness, resend, deliveryId } = setup({ bookingStatus: "checked-in" });
    await send(harness, deliveryId);
    expect(resend.deliveredCount()).toBe(1);
    expect(delivery(harness).providerDeliveryStatus).toBe("accepted");
  });
  it("retries an unknown outcome with the same idempotency key so the guest gets one email", async () => {
    const { harness, resend, deliveryId } = setup();
    resend.fail("network_after_accept");

    await send(harness, deliveryId);
    expect(delivery(harness)).toMatchObject({
      status: "failed",
      failureReason: "email_delivery_outcome_unknown",
      autoRetryAt: now0 + minute,
      providerKeyFirstUsedAt: now0
    });

    vi.setSystemTime(now0 + minute);
    await sendJobs(harness);

    expect(resend.calls.map((call) => call.idempotencyKey)).toEqual([
      `skyla-ticket/${ticketCode}/1`,
      `skyla-ticket/${ticketCode}/1`
    ]);
    expect(resend.calls[1].body).toBe(resend.calls[0].body);
    expect(resend.deliveredCount()).toBe(1);
    expect(delivery(harness)).toMatchObject({ status: "sent", providerMessageId: "email_1", sendVersion: 1 });
  });

  it("recovers a stale sending lease as an unknown outcome and resends with the same key", async () => {
    const { harness, resend } = setup({
      delivery: {
        status: "sending",
        attemptCount: 1,
        lastAttemptAt: now0 - 6 * minute,
        updatedAt: now0 - 6 * minute,
        providerKeyFirstUsedAt: now0 - 6 * minute
      }
    });

    await expect(harness.call(ticketDelivery.sweepTicketDeliveries, {})).resolves.toEqual({ scheduled: 0, recovered: 1 });
    expect(delivery(harness)).toMatchObject({ status: "failed", failureReason: "email_delivery_outcome_unknown" });

    vi.setSystemTime(now0 + minute);
    await sendJobs(harness);

    expect(resend.calls).toEqual([expect.objectContaining({ idempotencyKey: `skyla-ticket/${ticketCode}/1` })]);
    expect(delivery(harness).status).toBe("sent");
  });

  it("repairs a queued delivery whose scheduled send was lost", async () => {
    const { harness, resend } = setup();
    vi.setSystemTime(now0 + 3 * minute);

    await expect(harness.call(ticketDelivery.sweepTicketDeliveries, {})).resolves.toEqual({ scheduled: 1, recovered: 0 });
    await sendJobs(harness);

    expect(resend.deliveredCount()).toBe(1);
    expect(delivery(harness).status).toBe("sent");
  });

  it("stops automatic retries before the provider can forget the key and asks staff instead", async () => {
    const { harness, resend, fetchMock, deliveryId } = setup({
      delivery: {
        status: "failed",
        failureReason: "email_delivery_outcome_unknown",
        attemptCount: 3,
        providerKeyFirstUsedAt: now0 - 21 * hour,
        autoRetryAt: now0,
        autoRetryCount: 3
      }
    });

    await send(harness, deliveryId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resend.deliveredCount()).toBe(0);
    expect(delivery(harness)).toMatchObject({
      status: "failed",
      failureReason: "email_delivery_unknown_after_idempotency_window"
    });
    expect(delivery(harness).autoRetryAt).toBeUndefined();
    expect(openExceptions(harness)).toEqual([
      expect.objectContaining({
        category: "ticket_delivery",
        code: "email_delivery_unknown_after_idempotency_window",
        bookingRef: "ORDER-1"
      })
    ]);
  });

  it("does not schedule a retry that would land outside the safe window", async () => {
    const { harness, resend, deliveryId } = setup({
      delivery: { providerKeyFirstUsedAt: now0 - 20 * hour + 30 * 1000 }
    });
    resend.fail("status_500");

    await send(harness, deliveryId);

    expect(delivery(harness).autoRetryAt).toBeUndefined();
    expect(openExceptions(harness)[0]).toMatchObject({ code: "email_delivery_unknown_after_idempotency_window" });
  });

  it("claims one send when two workers race", async () => {
    const { harness, resend, deliveryId } = setup();

    await Promise.all([send(harness, deliveryId), send(harness, deliveryId)]);

    expect(resend.calls).toHaveLength(1);
    expect(delivery(harness)).toMatchObject({ status: "sent", attemptCount: 1 });
  });

  it("keeps a successful send final", async () => {
    const { harness, resend, deliveryId } = setup();
    await send(harness, deliveryId);
    vi.setSystemTime(now0 + hour);

    await harness.call(ticketDelivery.sweepTicketDeliveries, {});
    await sendJobs(harness);
    await send(harness, deliveryId);

    expect(resend.calls).toHaveLength(1);
    expect(delivery(harness).status).toBe("sent");
  });

  it.each([
    ["a cancelled booking", { bookingStatus: "cancelled" }, "booking_cancelled"],
    ["an order that was never paid", { orderStatus: "payment_pending" }, "order_not_paid"],
    ["a refunded, cancelled order", { orderStatus: "canceled" }, "order_not_paid"]
  ])("never emails a ticket for %s", async (_label, options, reason) => {
    const { harness, fetchMock, deliveryId } = setup(options);

    await send(harness, deliveryId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(delivery(harness)).toMatchObject({ status: "suppressed", failureReason: reason });
  });

  it("makes missing email configuration visible without starting the key window, then sends once configured", async () => {
    const { harness, resend, fetchMock, deliveryId } = setup();
    delete process.env.RESEND_API_KEY;

    await send(harness, deliveryId);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(delivery(harness)).toMatchObject({ status: "failed", failureReason: "email_provider_unconfigured", attemptCount: 0 });
    expect(delivery(harness).providerKeyFirstUsedAt).toBeUndefined();
    expect(delivery(harness).autoRetryAt).toBe(now0 + 15 * minute);
    expect(openExceptions(harness)).toEqual([expect.objectContaining({ code: "email_provider_unconfigured" })]);

    configureEmail();
    vi.setSystemTime(now0 + 15 * minute);
    await sendJobs(harness);

    expect(resend.deliveredCount()).toBe(1);
    expect(delivery(harness).status).toBe("sent");
    expect(harness.rows("operationsExceptions")[0]).toMatchObject({ status: "resolved", resolution: "sent_after_configuration" });
  });

  it("treats a rejected recipient or sender as permanent and does not retry", async () => {
    const { harness, resend, deliveryId } = setup();
    resend.fail("status_422");

    await send(harness, deliveryId);
    vi.setSystemTime(now0 + 2 * hour);
    await harness.call(ticketDelivery.sweepTicketDeliveries, {});
    await sendJobs(harness);

    expect(resend.calls).toHaveLength(1);
    expect(delivery(harness)).toMatchObject({ status: "failed", failureReason: "email_provider_422" });
    expect(openExceptions(harness)[0]).toMatchObject({ code: "email_provider_422", category: "ticket_delivery" });
  });

  it("uses a new, audited version when staff resend after the key window", async () => {
    const { harness } = setup({
      delivery: {
        status: "failed",
        failureReason: "email_delivery_unknown_after_idempotency_window",
        attemptCount: 2,
        providerKeyFirstUsedAt: now0 - 22 * hour
      }
    });
    harness.seed("staffUsers", { subject: "admin", emailLower: "admin@example.com", role: "admin", active: true, createdAt: 1, updatedAt: 1 });

    await expect(harness.call(ticketDelivery.requestTicketResend, { bookingRef: "ORDER-1" }, "admin")).resolves.toMatchObject({
      status: "queued",
      sendVersion: 2
    });
    expect(delivery(harness).providerKeyFirstUsedAt).toBeUndefined();
    expect(harness.rows("auditEvents").at(-1)).toMatchObject({
      action: "ticket.deliveryResendRequested",
      metadata: expect.objectContaining({ recoveryReason: "idempotency_window_elapsed_new_version" })
    });
  });
});
