// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { availabilityPayload, routeCheckoutFetch } from "./checkout-test-support";
import { CheckoutClient } from "./components/checkout-client";
import type { OperatingHours } from "./lib/operating-hours";

const operatingHours: OperatingHours = {
  Monday: { open: "09:00", close: "18:00", closed: false },
  Tuesday: { open: "12:00", close: "16:00", closed: false },
  Wednesday: { open: "11:00", close: "19:00", closed: false },
  Thursday: { open: "11:00", close: "19:00", closed: false },
  Friday: { open: "11:00", close: "21:00", closed: false },
  Saturday: { open: "10:00", close: "21:00", closed: false },
  Sunday: { open: "10:00", close: "18:00", closed: false }
};

// Friday 2026-10-02 at noon in Los Angeles.
const today = "2026-10-02";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderCheckout(hours: OperatingHours | null = operatingHours) {
  return render(
    <CheckoutClient
      packages={[{ key: "general", name: "The View", priceCents: 2000 }]}
      addons={[]}
      operatingHours={hours}
    />
  );
}

function timeButton(name: string | RegExp) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function reviewButton() {
  return screen.getByRole("button", { name: "Review Order" }) as HTMLButtonElement;
}

function enterEmail() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "guest@example.com" } });
}

const draftResponse = (orderRef: string, visitDate: string) => ({
  draft: {
    status: "draft",
    currency: "usd",
    subtotalCents: 4000,
    feeCents: 0,
    totalCents: 4000,
    orderRef,
    visitDate,
    lines: [{ kind: "ticket", name: "The View · Adult 18+", quantity: 2, unitAmountCents: 2000, lineTotalCents: 4000 }]
  },
  orderRef,
  persisted: true
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T19:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("checkout live availability", () => {
  it("keeps times and review locked while the live read loads", async () => {
    const pending = deferred<Response>();
    const router = routeCheckoutFetch(() => pending.promise);
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();

    expect(screen.getByText(/Checking live availability… Friday hours: 11:00 AM - 9:00 PM\./)).toBeTruthy();
    expect(screen.getByText("Dates and entry times are Los Angeles time (PT).")).toBeTruthy();
    expect(timeButton("12:00 PM").disabled).toBe(true);
    expect(reviewButton().disabled).toBe(true);

    await waitFor(() => expect(router.availabilityCalls()).toHaveLength(1));
    expect(String(router.availabilityCalls()[0][0])).toBe(`/api/availability?date=${today}&party=2`);
    pending.resolve(Response.json(availabilityPayload(today, 2)));

    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    expect(timeButton("9:00 AM").getAttribute("aria-pressed")).toBe("true");
  });

  it("never enables payment review after a failed authoritative read, and recovers on retry", async () => {
    let attempts = 0;
    const router = routeCheckoutFetch((visitDate, party) => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: "Live availability is unavailable" }, { status: 503 })
        : Response.json(availabilityPayload(visitDate, party));
    });
    vi.stubGlobal("fetch", router.fetchMock);
    // Hours config is unavailable too; nothing may fall back to all-day booking.
    renderCheckout(null);
    enterEmail();

    await screen.findByText("Live availability couldn't be loaded, so this order can't be reviewed yet.");
    expect(reviewButton().disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /^\d{1,2}:\d{2} [AP]M$/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    expect(attempts).toBe(2);
  });

  it("treats a malformed availability response as a failed read", async () => {
    const router = routeCheckoutFetch((visitDate, party) =>
      Response.json({ ...availabilityPayload(visitDate, party), slots: [] })
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();

    await screen.findByText("Live availability couldn't be loaded, so this order can't be reviewed yet.");
    expect(reviewButton().disabled).toBe(true);
  });

  it("enables only available slots and states the remaining places in LA time", async () => {
    const router = routeCheckoutFetch((visitDate, party) =>
      Response.json(
        availabilityPayload(visitDate, party, {
          dayHours: { open: "11:00", close: "21:00", closed: false },
          defaultStatus: "closed",
          slots: {
            "11:00": { status: "past" },
            "11:30": { status: "past" },
            "12:00": { status: "available", remaining: 6 },
            "12:30": { status: "full", remaining: 1 },
            "13:00": { status: "full", remaining: 0 },
            "13:30": { status: "available", remaining: 30 }
          }
        })
      )
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText("Friday hours: 11:00 AM - 9:00 PM. 6 of 30 places open at 12:00 PM.");
    expect(timeButton("11:30 AM").disabled).toBe(true);
    expect(timeButton("12:30 PM 1 left").disabled).toBe(true);
    expect(timeButton("1:00 PM Full").disabled).toBe(true);
    expect(timeButton("9:00 AM").disabled).toBe(true);
    expect(timeButton("12:00 PM").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(timeButton("1:30 PM"));
    expect(screen.getByText("Friday hours: 11:00 AM - 9:00 PM. 30 of 30 places open at 1:30 PM.")).toBeTruthy();
  });

  it.each([
    ["closed", "Sky LA has no checkout arrival times on Monday. Choose another date.", "closed"],
    ["private_event", "Mon, Oct 5 is reserved for a private event. Choose another date.", "private_event"],
    ["unverified", "Online availability can't be confirmed for this date. Choose another date or email us.", "unverified"],
    ["full", "No entry time on Mon, Oct 5 has room for 2 visitors. Try a smaller party or another date.", "full"]
  ] as const)("explains a %s date and keeps it unbookable", async (dayStatus, message, slotStatus) => {
    const router = routeCheckoutFetch((visitDate, party) =>
      Response.json(
        visitDate === "2026-10-05"
          ? availabilityPayload(visitDate, party, { today, dayStatus, defaultStatus: slotStatus })
          : availabilityPayload(visitDate, party)
      )
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();
    await waitFor(() => expect(reviewButton().disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });

    await screen.findByText(message);
    expect(reviewButton().disabled).toBe(true);
  });

  it("explains a past date and today's passed times", async () => {
    const router = routeCheckoutFetch((visitDate, party) =>
      Response.json(availabilityPayload(visitDate, party, { today, dayStatus: "past", defaultStatus: "past" }))
    );
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    await screen.findByText("Today's entry times have passed. Choose another date.");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-01" } });
    await screen.findByText("That date has passed. Choose another date.");
  });

  it("never lets a slower response for an earlier date overwrite the current one", async () => {
    const responses = new Map([
      [today, deferred<Response>()],
      ["2026-10-05", deferred<Response>()]
    ]);
    const router = routeCheckoutFetch((visitDate) => responses.get(visitDate)!.promise);
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();

    await waitFor(() => expect(router.availabilityCalls()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    await waitFor(() => expect(router.availabilityCalls()).toHaveLength(2));

    responses.get("2026-10-05")!.resolve(
      Response.json(availabilityPayload("2026-10-05", 2, { today, dayHours: { open: "09:00", close: "18:00", closed: false } }))
    );
    await screen.findByText("Monday hours: 9:00 AM - 6:00 PM. 30 of 30 places open at 9:00 AM.");

    responses.get(today)!.resolve(
      Response.json(availabilityPayload(today, 2, { dayStatus: "private_event", defaultStatus: "private_event" }))
    );
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.getByText("Monday hours: 9:00 AM - 6:00 PM. 30 of 30 places open at 9:00 AM.")).toBeTruthy();
    expect(screen.queryByText(/reserved for a private event/)).toBeNull();
    expect(reviewButton().disabled).toBe(false);
  });

  it("discards a reviewed draft on date change and reviews again with a new key", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();
    await waitFor(() => expect(reviewButton().disabled).toBe(false));

    router.queue.push(Response.json(draftResponse("SKY2610-FIRST", today)));
    fireEvent.click(reviewButton());
    await screen.findByText("Stored as SKY2610-FIRST");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    expect(screen.queryByText("Stored as SKY2610-FIRST")).toBeNull();
    expect(screen.getByText("Review your order to confirm the exact total.")).toBeTruthy();
    expect(reviewButton().disabled).toBe(true);
    await waitFor(() => expect(reviewButton().disabled).toBe(false));

    router.queue.push(Response.json(draftResponse("SKY2610-SECOND", "2026-10-05")));
    fireEvent.click(reviewButton());
    await screen.findByText("Stored as SKY2610-SECOND");

    const [first, second] = router.orderCalls().map(([, init]) => JSON.parse(String(init?.body)));
    expect(first).toMatchObject({ visitDate: today });
    expect(second).toMatchObject({ visitDate: "2026-10-05" });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("ignores a review response that returns after the date changed", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();
    await waitFor(() => expect(reviewButton().disabled).toBe(false));

    const lateDraft = deferred<Response>();
    router.queue.push(lateDraft.promise);
    fireEvent.click(reviewButton());
    await waitFor(() => expect(router.orderCalls()).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    lateDraft.resolve(Response.json(draftResponse("SKY2610-STALE", today)));
    await new Promise((settle) => setTimeout(settle, 20));

    expect(screen.queryByText("Stored as SKY2610-STALE")).toBeNull();
    expect(screen.getByText("Review your order to confirm the exact total.")).toBeTruthy();
  });

  it("refreshes live availability when the server rejects the slot at review", async () => {
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();
    enterEmail();
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    const readsBefore = router.availabilityCalls().length;

    router.queue.push(
      Response.json(
        { error: "Only 1 of 30 places remain for that entry time.", code: "visit_unavailable", persisted: false },
        { status: 409 }
      )
    );
    fireEvent.click(reviewButton());

    await screen.findByText("Only 1 of 30 places remain for that entry time.");
    await waitFor(() => expect(router.availabilityCalls().length).toBe(readsBefore + 1));
  });

  it("uses the Los Angeles date before UTC midnight rolls over", async () => {
    vi.setSystemTime(new Date("2026-10-03T06:30:00.000Z"));
    const router = routeCheckoutFetch();
    vi.stubGlobal("fetch", router.fetchMock);
    renderCheckout();

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-10-02");
    expect(dateInput.min).toBe("2026-10-02");
    expect(dateInput.max).toBe("2027-10-02");
    await waitFor(() => expect(router.availabilityCalls()).toHaveLength(1));
    expect(String(router.availabilityCalls()[0][0])).toContain("date=2026-10-02");
  });
});
