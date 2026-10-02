import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicVisitAvailability } from "./availability";
import { defaultHours } from "./lib/adminConfig";
import { loadDateOccupancy, peakOccupancy } from "./lib/capacity";
import { checkoutDraftTtlMs } from "./lib/checkoutDraftExpiry";
import { beginCheckoutPaymentAttempt, createCheckoutOrderDraft, expireCheckoutOrderDraft } from "./orderDrafts";
import { cancelPrivateEvent, createPrivateEvent, listPrivateEvents } from "./privateEvents";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = (row: Row) => boolean;

// Friday 2026-10-02, 12:00 PM in Los Angeles. Saturday 2026-10-03 is open
// 10:00-22:00 under the documented default hours.
const fridayNoon = Date.parse("2026-10-02T19:00:00.000Z");
const visitDate = "2026-10-03";

/**
 * In-memory stand-in for the Convex database. Mutations run one at a time and
 * roll back on error, which is the serializable, atomic behavior Convex gives
 * conflicting mutations in production.
 */
function createHarness() {
  const tables = new Map<string, Row[]>();
  const scheduled: Array<{ runAt: number; args: Record<string, unknown> }> = [];
  let nextId = 1;
  let identity: { subject: string } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const find = (id: string) => [...tables.values()].flat().find((row) => row._id === id);

  function results(table: string, filters: Filter[], sortField?: string) {
    const run = () => {
      const matched = rows(table).filter((row) => filters.every((filter) => filter(row)));
      return sortField
        ? matched.toSorted((left, right) => String(left[sortField]).localeCompare(String(right[sortField])))
        : matched;
    };
    return {
      first: async () => run()[0] ?? null,
      unique: async () => {
        const matched = run();
        if (matched.length > 1) throw new Error(`Expected unique ${table} row`);
        return matched[0] ?? null;
      },
      collect: async () => run(),
      take: async (count: number) => run().slice(0, count)
    };
  }

  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (query: unknown) => unknown) {
          const filters: Filter[] = [];
          let sortField: string | undefined;
          const builder = {
            eq(field: string, value: unknown) {
              filters.push((row) => row[field] === value);
              sortField ??= field;
              return builder;
            },
            gte(field: string, value: string) {
              filters.push((row) => typeof row[field] === "string" && (row[field] as string) >= value);
              sortField ??= field;
              return builder;
            },
            lt(field: string, value: number) {
              filters.push((row) => typeof row[field] === "number" && (row[field] as number) < value);
              return builder;
            }
          };
          build?.(builder);
          return results(table, filters, sortField);
        },
        ...results(table, [])
      };
    },
    async insert(table: string, doc: Record<string, unknown>) {
      const _id = `${table}|${String(nextId++).padStart(6, "0")}`;
      rows(table).push({ ...doc, _id, _creationTime: Date.now() });
      return _id;
    },
    async patch(id: string, update: Record<string, unknown>) {
      const row = find(id);
      if (!row) throw new Error(`Missing ${id}`);
      for (const [key, value] of Object.entries(update)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    async get(id: string) {
      return find(id) ?? null;
    },
    async delete(id: string) {
      for (const list of tables.values()) {
        const index = list.findIndex((row) => row._id === id);
        if (index >= 0) list.splice(index, 1);
      }
    }
  };

  const ctx = {
    db,
    auth: { getUserIdentity: async () => identity },
    scheduler: {
      async runAt(runAt: number, _reference: unknown, args: Record<string, unknown>) {
        scheduled.push({ runAt, args });
      },
      async runAfter(delay: number, _reference: unknown, args: Record<string, unknown>) {
        scheduled.push({ runAt: Date.now() + delay, args });
      }
    }
  };

  function call<Args, Result>(registered: unknown, args: Args, as?: string): Promise<Result> {
    const run = async () => {
      identity = as ? { subject: as } : null;
      const snapshot = structuredClone([...tables.entries()]);
      try {
        return await (registered as { _handler: (context: typeof ctx, input: Args) => Promise<Result> })._handler(
          ctx,
          args
        );
      } catch (error) {
        tables.clear();
        for (const [table, list] of snapshot) tables.set(table, list);
        throw error;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  function seedStaff(subject: string, role: "admin" | "pos" | "viewer") {
    rows("staffUsers").push({
      _id: `staffUsers|${subject}`,
      _creationTime: 1,
      subject,
      emailLower: `${subject}@example.com`,
      role,
      active: true,
      createdAt: 1,
      updatedAt: 1
    });
  }

  return { ctx, rows, scheduled, call, seedStaff };
}

type Harness = ReturnType<typeof createHarness>;
type DraftResult = { orderRef: string; status: string; visitDate: string; entryTime: string };
type Availability = Awaited<ReturnType<typeof availabilityFor>>;

let keySequence = 0;

function draftArgs(overrides: Record<string, unknown> = {}) {
  keySequence += 1;
  return {
    gatewayRateLimitKey: keySequence.toString(16).padStart(64, "0"),
    packageKey: "general",
    adults: 2,
    visitDate,
    entryTime: "14:00",
    customerEmail: "guest@example.com",
    idempotencyKey: `checkout_capacity_${String(keySequence).padStart(4, "0")}`,
    ...overrides
  };
}

function createDraft(harness: Harness, overrides: Record<string, unknown> = {}) {
  return harness.call<Record<string, unknown>, DraftResult>(createCheckoutOrderDraft, draftArgs(overrides));
}

function availabilityFor(harness: Harness, partySize: number, date = visitDate) {
  return harness.call<{ visitDate: string; partySize: number }, {
    dayStatus: string;
    slots: Array<{ entryTime: string; status: string; remaining: number }>;
  } & Record<string, unknown>>(getPublicVisitAvailability, { visitDate: date, partySize });
}

function slot(availability: Availability, entryTime: string) {
  return availability.slots.find((candidate) => candidate.entryTime === entryTime);
}

function activeHolds(harness: Harness) {
  return harness.rows("capacityReservations").filter((row) => row.status !== "released");
}

function heldPlaces(harness: Harness) {
  return activeHolds(harness).reduce((total, row) => total + (row.partySize as number), 0);
}

function seedPaidParty(harness: Harness, partySize: number, entryTime = "10:00", extra: Record<string, unknown> = {}) {
  const [hour, minute] = entryTime.split(":").map(Number);
  harness.rows("capacityReservations").push({
    _id: `capacityReservations|seed-${harness.rows("capacityReservations").length}`,
    _creationTime: 1,
    orderRef: `ORD-SEED-${harness.rows("capacityReservations").length}`,
    visitDate,
    entryTime,
    startMinutes: hour * 60 + minute,
    endMinutes: 22 * 60,
    partySize,
    status: "paid",
    createdAt: 1,
    updatedAt: 1,
    ...extra
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fridayNoon);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("capacity holds at draft creation", () => {
  it("holds all thirty places for a full party, free children included", async () => {
    const harness = createHarness();

    const draft = await createDraft(harness, { adults: 10, children: 10, freeChildren: 10 });

    expect(activeHolds(harness)).toEqual([
      expect.objectContaining({
        orderRef: draft.orderRef,
        visitDate,
        entryTime: "14:00",
        startMinutes: 14 * 60,
        endMinutes: 22 * 60,
        partySize: 30,
        status: "draft"
      })
    ]);
    await expect(createDraft(harness, { adults: 1 })).rejects.toThrow(
      "Visit unavailable: no places remain for that entry time"
    );
    expect(harness.rows("orders")).toHaveLength(1);
  });

  it("counts zero-priced children toward capacity", async () => {
    const harness = createHarness();
    await createDraft(harness, { adults: 1, freeChildren: 27 });

    expect(heldPlaces(harness)).toBe(28);
    await expect(createDraft(harness, { adults: 1, freeChildren: 2 })).rejects.toThrow(
      "only 2 of 30 places remain"
    );
    await expect(createDraft(harness, { adults: 1, freeChildren: 1 })).resolves.toMatchObject({ status: "draft" });
    expect(heldPlaces(harness)).toBe(30);
  });

  it("never exceeds thirty when last-place requests race", async () => {
    const harness = createHarness();
    seedPaidParty(harness, 26);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => createDraft(harness, { adults: 2 }))
    );

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(3);
    expect(heldPlaces(harness)).toBe(30);
    expect(harness.rows("orders")).toHaveLength(2);
  });

  it("reuses one order and hold for a retry and rejects a changed body", async () => {
    const harness = createHarness();
    const args = draftArgs();

    const first = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);
    const retry = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);
    expect(retry.orderRef).toBe(first.orderRef);

    await expect(
      harness.call(createCheckoutOrderDraft, { ...args, visitDate: "2026-10-05" })
    ).rejects.toThrow("idempotencyKey was already used for a different draft");
    await expect(harness.call(createCheckoutOrderDraft, { ...args, adults: 3 })).rejects.toThrow(
      "idempotencyKey was already used for a different draft"
    );

    expect(harness.rows("orders")).toHaveLength(1);
    expect(harness.rows("capacityReservations")).toHaveLength(1);
  });

  it.each([
    ["a missing date", { visitDate: undefined }, "visitDate is required"],
    ["a missing time", { entryTime: undefined }, "entryTime is required"],
    ["an impossible date", { visitDate: "2026-02-30" }, "visitDate must be a real calendar date"],
    ["a past date", { visitDate: "2026-10-01" }, "Visit unavailable: that date has already passed"],
    ["an earlier slot today", { visitDate: "2026-10-02", entryTime: "11:30" }, "already passed today"],
    ["a closed hour", { entryTime: "09:00" }, "outside the configured operating hours"],
    ["a date past the horizon", { visitDate: "2027-10-03" }, "more than 365 days ahead"]
  ])("rejects %s without writing an order or hold", async (_label, overrides, message) => {
    const harness = createHarness();

    await expect(createDraft(harness, overrides)).rejects.toThrow(message);

    expect(harness.rows("orders")).toHaveLength(0);
    expect(harness.rows("capacityReservations")).toHaveLength(0);
  });

  it("accepts the next slot later today", async () => {
    const harness = createHarness();
    await expect(createDraft(harness, { visitDate: "2026-10-02", entryTime: "12:00" })).resolves.toMatchObject({
      visitDate: "2026-10-02",
      entryTime: "12:00"
    });
  });
});

describe("occupancy forecast", () => {
  it("keeps a paid party's places through closing with no guessed visit length", async () => {
    vi.setSystemTime(Date.parse("2026-10-03T23:00:00.000Z")); // Saturday 4:00 PM in LA
    const harness = createHarness();
    seedPaidParty(harness, 30, "10:00");

    const availability = await availabilityFor(harness, 1);
    expect(slot(availability, "16:30")).toMatchObject({ status: "full", remaining: 0 });
    expect(slot(availability, "15:30")).toMatchObject({ status: "past" });
    expect(availability.dayStatus).toBe("full");
  });

  it("reopens places only after a recorded departure, from that moment on", async () => {
    vi.setSystemTime(Date.parse("2026-10-03T20:30:00.000Z")); // Saturday 1:30 PM in LA
    const harness = createHarness();
    seedPaidParty(harness, 30, "10:00", { departedAt: Date.parse("2026-10-03T20:00:00.000Z") });

    const availability = await availabilityFor(harness, 4);
    expect(slot(availability, "14:00")).toMatchObject({ status: "available", remaining: 30 });
    const occupancy = await loadDateOccupancy(harness.ctx as never, visitDate, defaultHours);
    expect(peakOccupancy(occupancy.intervals, 12 * 60, 22 * 60)).toBe(30);
    expect(peakOccupancy(occupancy.intervals, 13 * 60, 22 * 60)).toBe(0);
  });

  it("measures each entry time against everyone inside from then until closing", async () => {
    const harness = createHarness();
    seedPaidParty(harness, 20, "18:00");

    const availability = await availabilityFor(harness, 12);
    // The 18:00 party overlaps every earlier entry's span, so 10 places remain all day.
    expect(slot(availability, "10:00")).toMatchObject({ status: "full", remaining: 10 });
    expect(slot(availability, "20:30")).toMatchObject({ status: "full", remaining: 10 });
    expect((await availabilityFor(harness, 10)).dayStatus).toBe("open");
  });

  it("counts committed bookings that have no reservation row, once", async () => {
    const harness = createHarness();
    harness.rows("bookings").push(
      { _id: "bookings|pos", _creationTime: 1, bookingRef: "SALE-1", saleRef: "SALE-1", visitDate, partySize: 5, status: "confirmed", createdAt: 1 },
      { _id: "bookings|in", _creationTime: 1, bookingRef: "OLD-1", orderRef: "OLD-1", visitDate, entryTime: "11:00", partySize: 3, status: "checked-in", createdAt: 1 },
      { _id: "bookings|x", _creationTime: 1, bookingRef: "OLD-2", orderRef: "OLD-2", visitDate, partySize: 9, status: "cancelled", createdAt: 1 }
    );
    seedPaidParty(harness, 4, "12:00", { orderRef: "ORD-PAID" });
    harness.rows("bookings").push({
      _id: "bookings|paid",
      _creationTime: 1,
      bookingRef: "ORD-PAID",
      orderRef: "ORD-PAID",
      visitDate,
      entryTime: "12:00",
      partySize: 4,
      status: "confirmed",
      createdAt: 1
    });

    const availability = await availabilityFor(harness, 1);
    expect(slot(availability, "14:00")).toMatchObject({ status: "available", remaining: 18 });
  });

  it.each([
    [
      "an unknown party size",
      (harness: Harness) =>
        harness.rows("bookings").push({ _id: "bookings|u", _creationTime: 1, bookingRef: "L", visitDate, status: "confirmed", createdAt: 1 })
    ],
    [
      "an unknown booking state",
      (harness: Harness) =>
        harness.rows("bookings").push({ _id: "bookings|s", _creationTime: 1, bookingRef: "L", visitDate, partySize: 2, status: "pending", createdAt: 1 })
    ],
    [
      "an undated committed booking",
      (harness: Harness) =>
        harness.rows("bookings").push({ _id: "bookings|d", _creationTime: 1, bookingRef: "L", partySize: 2, status: "confirmed", createdAt: 1 })
    ],
    [
      "unreconciled legacy imports",
      (harness: Harness) =>
        harness.rows("legacyMigrationSources").push({
          _id: "legacyMigrationSources|1",
          _creationTime: 1,
          source: "supabase",
          bookingCount: 12,
          memberCount: 0,
          inquiryCount: 0,
          ledgerRecordCount: 12,
          batchCount: 1,
          activeBatchCount: 1,
          updatedAt: 1
        })
    ]
  ])("fails closed for %s instead of offering thirty fresh places", async (_label, seed) => {
    const harness = createHarness();
    seed(harness);

    const availability = await availabilityFor(harness, 1);
    expect(availability.dayStatus).toBe("unverified");
    expect(availability.slots.every((candidate) => candidate.status !== "available")).toBe(true);
    await expect(createDraft(harness)).rejects.toThrow("online availability cannot be confirmed");
  });

  it("returns only anonymous aggregate availability", async () => {
    const harness = createHarness();
    harness.seedStaff("admin", "admin");
    const draft = await createDraft(harness, { customerEmail: "private-guest@example.com" });
    await harness.call(
      createPrivateEvent,
      { visitDate: "2026-10-10", label: "Secret Gala Label", idempotencyKey: "private_event_anon_01" },
      "admin"
    );

    const open = await availabilityFor(harness, 2);
    const blocked = await availabilityFor(harness, 2, "2026-10-10");
    for (const result of [open, blocked]) {
      expect(Object.keys(result).sort()).toEqual(
        ["capacity", "dayHours", "dayStatus", "partySize", "slots", "timeZone", "today", "visitDate", "weekday"].sort()
      );
      const serialized = JSON.stringify(result);
      for (const secret of [draft.orderRef, "private-guest@example.com", "Secret Gala Label", "PEV", "tkt_"]) {
        expect(serialized).not.toContain(secret);
      }
    }
    expect(slot(open, "14:00")).toMatchObject({ status: "available", remaining: 28 });
    expect(blocked.dayStatus).toBe("private_event");
  });
});

describe("hold lifecycle", () => {
  async function beginPayment(harness: Harness, draft: DraftResult, idempotencyKey: string) {
    return harness.call(beginCheckoutPaymentAttempt, { orderRef: draft.orderRef, idempotencyKey });
  }

  it("releases a draft hold when the draft expires", async () => {
    const harness = createHarness();
    const draft = await createDraft(harness);
    expect(harness.scheduled[0]).toMatchObject({ runAt: fridayNoon + checkoutDraftTtlMs, args: { orderRef: draft.orderRef } });

    vi.setSystemTime(fridayNoon + checkoutDraftTtlMs);
    await expect(harness.call(expireCheckoutOrderDraft, { orderRef: draft.orderRef })).resolves.toEqual({ expired: true });

    expect(harness.rows("capacityReservations")[0]).toMatchObject({ status: "released", releaseReason: "draft_expired" });
    expect(slot(await availabilityFor(harness, 30), "14:00")).toMatchObject({ status: "available", remaining: 30 });
  });

  it("moves draft and hold to payment_pending before Stripe, and TTL never releases it", async () => {
    const harness = createHarness();
    const args = draftArgs();
    const draft = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);

    await expect(beginPayment(harness, draft, args.idempotencyKey)).resolves.toEqual({
      status: "payment_pending",
      reused: false
    });
    expect(harness.rows("orders")[0]).toMatchObject({ status: "payment_pending", expectedProvider: "stripe" });
    expect(harness.rows("capacityReservations")[0]).toMatchObject({
      status: "payment_pending",
      paymentPendingAt: fridayNoon
    });

    await expect(beginPayment(harness, draft, args.idempotencyKey)).resolves.toEqual({
      status: "payment_pending",
      reused: true
    });

    vi.setSystemTime(fridayNoon + checkoutDraftTtlMs * 10);
    await expect(harness.call(expireCheckoutOrderDraft, { orderRef: draft.orderRef })).resolves.toEqual({ expired: false });
    expect(harness.rows("capacityReservations")[0].status).toBe("payment_pending");
    expect(harness.rows("orders")[0].status).toBe("payment_pending");
  });

  it("does not start payment for a slot that passed while the draft waited", async () => {
    vi.setSystemTime(Date.parse("2026-10-02T20:55:00.000Z")); // 1:55 PM in LA
    const harness = createHarness();
    const args = draftArgs({ visitDate: "2026-10-02", entryTime: "14:00" });
    const draft = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);

    vi.setSystemTime(Date.parse("2026-10-02T21:05:00.000Z")); // 2:05 PM
    await expect(beginPayment(harness, draft, args.idempotencyKey)).rejects.toThrow("already passed today");
    expect(harness.rows("orders")[0].status).toBe("draft");
    expect(harness.rows("capacityReservations")[0].status).toBe("draft");
  });

  it("reserves at payment start for an older draft without a hold, or stops before Stripe when full", async () => {
    const harness = createHarness();
    const args = draftArgs();
    const draft = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);
    harness.rows("capacityReservations").length = 0;

    seedPaidParty(harness, 29);
    await expect(beginPayment(harness, draft, args.idempotencyKey)).rejects.toThrow("only 1 of 30 places remain");
    expect(harness.rows("orders")[0].status).toBe("draft");

    harness.rows("capacityReservations").length = 0;
    await expect(beginPayment(harness, draft, args.idempotencyKey)).resolves.toMatchObject({ status: "payment_pending" });
    expect(harness.rows("capacityReservations")).toEqual([
      expect.objectContaining({ orderRef: draft.orderRef, status: "payment_pending", partySize: 2 })
    ]);
  });

  it("refuses to start payment once the hold was released", async () => {
    const harness = createHarness();
    const args = draftArgs();
    const draft = await harness.call<typeof args, DraftResult>(createCheckoutOrderDraft, args);
    harness.rows("capacityReservations")[0].status = "released";

    await expect(beginPayment(harness, draft, args.idempotencyKey)).rejects.toThrow(
      "the capacity hold for this order is released"
    );
  });
});

describe("confirmed private events", () => {
  const eventArgs = (overrides: Record<string, unknown> = {}) => ({
    visitDate: "2026-10-10",
    label: "Corporate buyout",
    idempotencyKey: "private_event_0001",
    ...overrides
  });

  function staffHarness() {
    const harness = createHarness();
    harness.seedStaff("admin", "admin");
    harness.seedStaff("viewer", "viewer");
    harness.seedStaff("pos", "pos");
    return harness;
  }

  it("lets an admin block a whole LA date with an audit record and blocks sales", async () => {
    const harness = staffHarness();

    const created = await harness.call<ReturnType<typeof eventArgs>, { event: { eventRef: string; status: string }; reused: boolean }>(
      createPrivateEvent,
      eventArgs(),
      "admin"
    );

    expect(created).toMatchObject({ reused: false, event: { status: "confirmed", eventRef: expect.stringMatching(/^PEV20261010-[A-Z0-9]{6}$/) } });
    expect(harness.rows("auditEvents")).toEqual([
      expect.objectContaining({ action: "privateEvent.create", entityRef: created.event.eventRef, actorStaffUserId: "staffUsers|admin" })
    ]);
    await expect(createDraft(harness, { visitDate: "2026-10-10" })).rejects.toThrow(
      "Visit unavailable: that date is reserved for a private event"
    );
    expect((await availabilityFor(harness, 1, "2026-10-10")).dayStatus).toBe("private_event");
  });

  it("is admin-only to change and read-only for viewers", async () => {
    const harness = staffHarness();

    await expect(harness.call(createPrivateEvent, eventArgs(), "viewer")).rejects.toThrow("Staff role must be one of: admin");
    await expect(harness.call(createPrivateEvent, eventArgs(), "pos")).rejects.toThrow("Staff role must be one of: admin");
    await expect(harness.call(createPrivateEvent, eventArgs())).rejects.toThrow("Staff authentication is required");
    await harness.call(createPrivateEvent, eventArgs(), "admin");

    await expect(harness.call(listPrivateEvents, {}, "viewer")).resolves.toMatchObject({
      fromDate: "2026-10-02",
      events: [expect.objectContaining({ visitDate: "2026-10-10", status: "confirmed" })]
    });
    await expect(harness.call(listPrivateEvents, {}, "pos")).rejects.toThrow("Staff role must be one of: admin, viewer");
    const eventRef = harness.rows("privateEvents")[0].eventRef as string;
    await expect(harness.call(cancelPrivateEvent, { eventRef, reason: "test" }, "viewer")).rejects.toThrow(
      "Staff role must be one of: admin"
    );
  });

  it("rejects a date with held or committed visitor places", async () => {
    const harness = staffHarness();
    await createDraft(harness, { visitDate: "2026-10-10", adults: 1, freeChildren: 1 });

    await expect(harness.call(createPrivateEvent, eventArgs(), "admin")).rejects.toThrow(
      "Private event conflicts with 2 held or committed visitor places on that date"
    );
    expect(harness.rows("privateEvents")).toHaveLength(0);
  });

  it("rejects a date with a committed booking lacking a reservation row", async () => {
    const harness = staffHarness();
    harness.rows("bookings").push({
      _id: "bookings|pos",
      _creationTime: 1,
      bookingRef: "SALE-1",
      saleRef: "SALE-1",
      visitDate: "2026-10-10",
      partySize: 1,
      status: "confirmed",
      createdAt: 1
    });

    await expect(harness.call(createPrivateEvent, eventArgs(), "admin")).rejects.toThrow("conflicts with 1 held or committed visitor place");
  });

  it("serializes a race with a checkout draft so only one wins", async () => {
    const harness = staffHarness();

    const [event, draft] = await Promise.allSettled([
      harness.call(createPrivateEvent, eventArgs(), "admin"),
      createDraft(harness, { visitDate: "2026-10-10" })
    ]);
    expect(event.status).toBe("fulfilled");
    expect(draft.status).toBe("rejected");

    const second = staffHarness();
    const [secondDraft, secondEvent] = await Promise.allSettled([
      createDraft(second, { visitDate: "2026-10-10" }),
      second.call(createPrivateEvent, eventArgs(), "admin")
    ]);
    expect(secondDraft.status).toBe("fulfilled");
    expect(secondEvent.status).toBe("rejected");
  });

  it("blocks private-event confirmation while imported bookings are unreconciled", async () => {
    const harness = staffHarness();
    harness.rows("legacyMigrationSources").push({
      _id: "legacyMigrationSources|unreconciled",
      _creationTime: 1,
      bookingCount: 1
    });

    await expect(harness.call(createPrivateEvent, eventArgs(), "admin")).rejects.toThrow(
      "Private event conflicts with visit records that cannot be verified for that date"
    );
    expect(harness.rows("privateEvents")).toHaveLength(0);
    expect(harness.rows("auditEvents")).toHaveLength(0);
  });

  it("does not treat an inquiry as a booking", async () => {
    const harness = staffHarness();
    harness.rows("inquiries").push({
      _id: "inquiries|1",
      _creationTime: 1,
      status: "new",
      experience: "full-venue",
      eventDate: "2026-10-10",
      guestCount: "80",
      createdAt: 1
    });

    expect((await availabilityFor(harness, 4, "2026-10-10")).dayStatus).toBe("open");
    await expect(harness.call(createPrivateEvent, eventArgs(), "admin")).resolves.toMatchObject({ reused: false });
    expect(harness.rows("inquiries")[0]).toMatchObject({ status: "new" });
  });

  it("is idempotent per key, rejects a changed body, and rejects a second event that date", async () => {
    const harness = staffHarness();
    const first = await harness.call<ReturnType<typeof eventArgs>, { event: { eventRef: string } }>(createPrivateEvent, eventArgs(), "admin");

    await expect(harness.call(createPrivateEvent, eventArgs(), "admin")).resolves.toMatchObject({
      reused: true,
      event: { eventRef: first.event.eventRef }
    });
    await expect(harness.call(createPrivateEvent, eventArgs({ label: "Changed" }), "admin")).rejects.toThrow(
      "idempotencyKey was already used for a different private event"
    );
    await expect(
      harness.call(createPrivateEvent, eventArgs({ idempotencyKey: "private_event_0002" }), "admin")
    ).rejects.toThrow("Private event conflicts with an existing confirmed private event on that date");
    expect(harness.rows("privateEvents")).toHaveLength(1);
  });

  it("cancels without deleting, keeps history, and reopens the date only for new holds", async () => {
    const harness = staffHarness();
    const created = await harness.call<ReturnType<typeof eventArgs>, { event: { eventRef: string } }>(createPrivateEvent, eventArgs(), "admin");

    await expect(
      harness.call(cancelPrivateEvent, { eventRef: created.event.eventRef, reason: "Client postponed" }, "admin")
    ).resolves.toMatchObject({ reused: false, event: { status: "cancelled", cancelReason: "Client postponed" } });
    await expect(
      harness.call(cancelPrivateEvent, { eventRef: created.event.eventRef, reason: "Again" }, "admin")
    ).resolves.toMatchObject({ reused: true, event: { cancelReason: "Client postponed" } });

    expect(harness.rows("privateEvents")).toEqual([
      expect.objectContaining({ status: "cancelled", label: "Corporate buyout", cancelledBy: "staffUsers|admin" })
    ]);
    expect(harness.rows("auditEvents").map((row) => row.action)).toEqual(["privateEvent.create", "privateEvent.cancel"]);
    await expect(createDraft(harness, { visitDate: "2026-10-10" })).resolves.toMatchObject({ status: "draft" });
  });

  it("rejects past dates for new events", async () => {
    const harness = staffHarness();
    await expect(harness.call(createPrivateEvent, eventArgs({ visitDate: "2026-10-01" }), "admin")).rejects.toThrow(
      "visitDate must be today or later in Los Angeles"
    );
  });
});
