import { checkoutEntryTimes, venueCapacity, visitWeekdayForDate, type VisitHoursDay } from "@skyla/payments";
import { vi } from "vitest";

import type { VisitAvailability, VisitDayStatus, VisitSlotStatus } from "./lib/visit-availability";

type AvailabilityOptions = {
  today?: string;
  dayStatus?: VisitDayStatus;
  dayHours?: VisitHoursDay;
  /** Status for every slot not listed in `slots`. */
  defaultStatus?: VisitSlotStatus;
  slots?: Record<string, { status: VisitSlotStatus; remaining?: number }>;
};

/** A server-shaped anonymous availability payload for UI tests. */
export function availabilityPayload(
  visitDate: string,
  partySize: number,
  options: AvailabilityOptions = {}
): VisitAvailability {
  const defaultStatus = options.defaultStatus ?? "available";
  return {
    visitDate,
    timeZone: "America/Los_Angeles",
    today: options.today ?? visitDate,
    weekday: visitWeekdayForDate(visitDate)!,
    capacity: venueCapacity,
    partySize,
    dayStatus: options.dayStatus ?? "open",
    dayHours: options.dayHours ?? { open: "09:00", close: "21:00", closed: false },
    slots: checkoutEntryTimes.map(({ value }) => {
      const slot = options.slots?.[value];
      const status = slot?.status ?? defaultStatus;
      return {
        entryTime: value,
        status,
        remaining: slot?.remaining ?? (status === "available" ? venueCapacity : 0)
      };
    })
  };
}

const releaseUrl = "/api/order-drafts/checkout/release";

/**
 * Routes checkout fetches: live availability reads go to `availability`,
 * best-effort draft releases are recorded and answered, and every other
 * request takes the next queued response, in order.
 */
export function routeCheckoutFetch(
  availability: (visitDate: string, partySize: number) => Response | Promise<Response> = (visitDate, partySize) =>
    Response.json(availabilityPayload(visitDate, partySize))
) {
  const queue: Array<Response | Promise<Response>> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/availability")) {
      const params = new URL(url, "http://localhost").searchParams;
      return availability(params.get("date") ?? "", Number(params.get("party")));
    }
    if (url === releaseUrl) {
      return Response.json({ released: true });
    }
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch ${url}`);
    return next;
  });
  const isOrderCall = (url: unknown) => !String(url).startsWith("/api/availability") && String(url) !== releaseUrl;
  return {
    fetchMock,
    queue,
    availabilityCalls: () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/availability")),
    orderCalls: () => fetchMock.mock.calls.filter(([url]) => isOrderCall(url)),
    releaseCalls: () => fetchMock.mock.calls.filter(([url]) => String(url) === releaseUrl),
    paymentCalls: () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/payments/stripe-checkout")
  };
}
