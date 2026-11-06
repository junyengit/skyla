import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConvexHarness } from "./convexHarness.testkit";
import * as ticketDeliveryTracking from "./ticketDeliveryTracking";

const now0 = Date.parse("2026-10-02T19:00:00Z");
const minute = 60_000;
const day = 24 * 60 * minute;

function setup() {
  const harness = createConvexHarness({ ticketDeliveryTracking });
  const id = harness.seed("ticketDeliveries", {
    bookingRef: "BOOK-1", orderRef: "ORDER-1", emailLower: "guest@example.com",
    status: "sent", sendVersion: 1, providerMessageId: "email-1", sentAt: now0,
    providerDeliveryStatus: "accepted", providerTrackingAt: now0, providerTrackingCount: 0,
    createdAt: now0, updatedAt: now0
  });
  let event = "delivered";
  let status = 200;
  let overrides: Record<string, unknown> = {};
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
    object: "email", id: "email-1", to: ["guest@example.com"], last_event: event, ...overrides
  }, { status }));
  vi.stubGlobal("fetch", fetchMock);
  const track = () => harness.runAction(ticketDeliveryTracking.trackTicketDelivery, { deliveryId: id });
  const row = () => harness.rows("ticketDeliveries")[0];
  return { harness, id, row, fetchMock, track, event: (value: string) => { event = value; },
    status: (value: number) => { status = value; }, tamper: (value: Record<string, unknown>) => { overrides = value; } };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now0); vi.stubEnv("RESEND_API_KEY", "re_tracking_fixture"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("accepted ticket email delivery tracking", () => {
  it("distinguishes acceptance from correlated delivery with one GET under concurrent workers", async () => {
    const t = setup();
    expect(t.row().deliveredAt).toBeUndefined();
    await Promise.all([t.track(), t.track()]);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails/email-1");
    expect(init?.method).toBeUndefined();
    expect(t.row()).toMatchObject({ status: "sent", providerDeliveryStatus: "delivered", deliveredAt: now0,
      providerTrackingAt: now0 + day, providerTrackingCount: 1 });
    expect(t.harness.rows("operationsExceptions")).toHaveLength(0);
  });

  it.each(["bounced", "complained", "failed", "suppressed", "canceled"])("records %s without another send or billing change", async (event) => {
    const t = setup(); t.event(event);
    await t.track();
    expect(t.row()).toMatchObject({ status: "sent", providerDeliveryStatus: event });
    expect(t.row().providerTrackingAt).toBeUndefined();
    expect(t.harness.rows("operationsExceptions")[0]).toMatchObject({ category: "ticket_delivery", code: `email_${event}` });
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    expect(t.harness.rows("paymentEvents")).toHaveLength(0);
    await t.track(); expect(t.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can observe a complaint after delivery without losing the earlier delivery fact", async () => {
    const t = setup(); await t.track();
    vi.setSystemTime(now0 + day); t.event("complained"); await t.track();
    expect(t.row()).toMatchObject({ deliveredAt: now0, providerDeliveryStatus: "complained" });
    expect(t.harness.rows("operationsExceptions")[0].code).toBe("email_complained");
  });

  it.each([{ id: "wrong" }, { to: ["someone-else@example.com"] }, { last_event: "invented" }])(
    "does not claim delivery for mismatched provider evidence %j", async (override) => {
      const t = setup(); t.tamper(override); await t.track();
      expect(t.row().deliveredAt).toBeUndefined();
      expect(t.row().providerDeliveryStatus).toBe("accepted");
      expect(t.harness.rows("operationsExceptions")[0].code).toBe("email_tracking_response_invalid");
    }
  );

  it.each([401, 403, 404, 500])("bounds tracking failures for provider HTTP %s without resending", async (status) => {
    const t = setup(); t.status(status);
    for (let n = 0; n < 31; n++) {
      if (n) vi.setSystemTime(t.row().providerTrackingAt as number);
      await t.track();
      if (t.row().providerTrackingAt === undefined) break;
    }
    expect(t.fetchMock.mock.calls.length).toBeLessThanOrEqual(30);
    expect(t.row().providerTrackingAt).toBeUndefined();
    expect(t.row().deliveredAt).toBeUndefined();
    expect(t.harness.rows("operationsExceptions").some((row) => row.code === "email_delivery_tracking_unconfirmed")).toBe(true);
  });

  it("reports missing read credentials without a network request, and resolves the gap after delivery", async () => {
    const t = setup(); vi.stubEnv("RESEND_API_KEY", ""); await t.track();
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.harness.rows("operationsExceptions")[0].code).toBe("email_tracking_unconfigured");
    vi.setSystemTime(t.row().providerTrackingAt as number); vi.stubEnv("RESEND_API_KEY", "re_tracking_fixture");
    await t.track();
    expect(t.harness.rows("operationsExceptions")[0].status).toBe("resolved");
  });

  it("discards a stale result after an explicit new send version and repairs a lost scheduled read", async () => {
    const t = setup();
    const claim = await t.harness.call<{ leaseToken: string; sendVersion: number; messageId: string }>(
      ticketDeliveryTracking.claimTicketDeliveryTracking, { deliveryId: t.id, leaseToken: "old-worker" });
    t.row().sendVersion = 2; t.row().providerMessageId = "email-2";
    await expect(t.harness.call(ticketDeliveryTracking.recordTicketDeliveryTracking, {
      deliveryId: t.id, ...claim, emailLower: undefined, event: "delivered"
    })).resolves.toEqual({ applied: false });
    expect(t.row().deliveredAt).toBeUndefined();
    vi.setSystemTime(now0 + 3 * minute);
    await expect(t.harness.call(ticketDeliveryTracking.sweepTicketDeliveryTracking, {})).resolves.toEqual({ scheduled: 1 });
  });
});
