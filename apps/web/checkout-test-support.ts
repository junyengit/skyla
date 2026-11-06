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

type LockRequestOptions = { mode?: "exclusive" | "shared"; ifAvailable?: boolean; steal?: boolean };
type LockCallback = (lock: { name: string; mode: "exclusive" } | null) => unknown;

/**
 * A same-origin Web Locks service shared by every simulated window, modeling
 * the exclusive-mode semantics checkout relies on: a grant is held until the
 * callback's returned promise settles; `ifAvailable` on a held name calls the
 * callback with null instead of waiting; other requests wait in order and are
 * handed the lock directly on release. `steal` and shared mode are refused.
 */
export function createLockCoordinator() {
  const holders = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  let rejection: Error | null = null;
  const history: Array<{ name: string; ifAvailable: boolean; granted: boolean }> = [];

  function release(name: string) {
    const next = waiters.get(name)?.shift();
    // Hand off without a gap in which an ifAvailable request could slip in.
    if (next) next();
    else holders.delete(name);
  }

  async function request(name: string, optionsOrCallback: LockRequestOptions | LockCallback, maybeCallback?: LockCallback) {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
    const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    if (rejection) throw rejection;
    if (options.steal) throw new DOMException("Checkout must never steal a lock", "NotSupportedError");
    if ((options.mode ?? "exclusive") !== "exclusive") throw new DOMException("Only exclusive mode is modeled", "NotSupportedError");
    // The callback always runs asynchronously, as in browsers.
    await Promise.resolve();
    if (holders.has(name)) {
      if (options.ifAvailable) {
        history.push({ name, ifAvailable: true, granted: false });
        return callback(null);
      }
      await new Promise<void>((resolve) => {
        const queue = waiters.get(name) ?? [];
        queue.push(resolve);
        waiters.set(name, queue);
      });
    } else {
      holders.add(name);
    }
    history.push({ name, ifAvailable: Boolean(options.ifAvailable), granted: true });
    try {
      return await callback({ name, mode: "exclusive" });
    } finally {
      release(name);
    }
  }

  return {
    manager: { request },
    isHeld: (name: string) => holders.has(name),
    /** Requests refused because another holder had the lock. */
    contended: (name: string) => history.filter((entry) => entry.name === name && !entry.granted).length,
    /** Makes every later request reject, as a browser may for an opaque origin. */
    rejectRequests(error: Error | null) {
      rejection = error;
    },
    /** Another window takes the lock (waiting if needed) and keeps it until released. */
    async hold(name: string) {
      let granted!: () => void;
      const acquired = new Promise<void>((resolve) => {
        granted = resolve;
      });
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const settled = request(name, { mode: "exclusive" }, () => {
        granted();
        return done;
      });
      await acquired;
      return async () => {
        finish();
        await settled;
      };
    }
  };
}

export type LockCoordinator = ReturnType<typeof createLockCoordinator>;

/**
 * The origin's localStorage with Web Storage semantics: values are strings,
 * a missing key reads as null. Methods live on the prototype so tests can
 * fault them the way a blocked or full browser store fails.
 */
export class OriginStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(String(key)) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.#items.delete(String(key));
  }
  clear() {
    this.#items.clear();
  }
}

/**
 * Gives the happy-dom window the platform a real secure browser has: a secure
 * context, Web Locks (happy-dom reports `navigator.locks` as null) and one
 * fresh origin localStorage (Node 25's own global `localStorage` can shadow
 * happy-dom's and is unusable without a backing file). Every simulated window
 * shares this storage and lock service. Pass `locks: "missing"` or
 * `secureContext: false` to model browsers checkout must refuse. `restore()`
 * puts the window back exactly as it was.
 */
export function installCheckoutBrowserPlatform(
  options: { secureContext?: boolean; locks?: "shared" | "missing"; coordinator?: LockCoordinator; storage?: Storage } = {}
) {
  const coordinator = options.coordinator ?? createLockCoordinator();
  const storage = options.storage ?? new OriginStorage();
  const previous = {
    secure: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
    locks: Object.getOwnPropertyDescriptor(window.navigator, "locks"),
    storage: Object.getOwnPropertyDescriptor(window, "localStorage")
  };
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: options.secureContext ?? true });
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: options.locks === "missing" ? undefined : coordinator.manager
  });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  return {
    coordinator,
    storage,
    restore() {
      if (previous.secure) Object.defineProperty(window, "isSecureContext", previous.secure);
      else delete (window as { isSecureContext?: boolean }).isSecureContext;
      if (previous.locks) Object.defineProperty(window.navigator, "locks", previous.locks);
      else delete (window.navigator as { locks?: unknown }).locks;
      if (previous.storage) Object.defineProperty(window, "localStorage", previous.storage);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
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
