import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLockCoordinator, type LockCoordinator } from "./checkout-test-support";
import {
  checkoutIntentChangeEvent,
  checkoutIntentStorageKey,
  checkoutLockName,
  createCheckoutRecovery,
  readCheckoutIntentSlot,
  withCheckoutLock,
  type CheckoutIntentRecord,
  type CheckoutRecoveryHost
} from "./lib/checkout-recovery";

const origin = "https://skydeck.example";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function intent(orderRef: string, idempotencyKey: string): CheckoutIntentRecord {
  return { version: 1, orderRef, idempotencyKey };
}

function raw(record: CheckoutIntentRecord) {
  return JSON.stringify(record);
}

/** Lets queued storage-event tasks run, as a browser's event loop would. */
function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One origin's durable localStorage, seen through a separate Storage object
 * per window. As in browsers, a change made through one window queues a
 * storage event for every other window of the origin, never for the writer.
 */
function createOriginStorage() {
  const items = new Map<string, string>();
  const windows = new Set<Window>();

  function broadcast(writer: Window, key: string | null, oldValue: string | null, newValue: string | null) {
    for (const other of windows) {
      if (other === writer) continue;
      // happy-dom's init type spells a missing value as undefined; the event reports it as null.
      const init = { key: key ?? undefined, oldValue: oldValue ?? undefined, newValue: newValue ?? undefined, url: `${origin}/checkout` };
      setTimeout(() => other.dispatchEvent(new other.StorageEvent("storage", init)), 0);
    }
  }

  class WindowStorage implements Storage {
    constructor(private readonly owner: Window) {}
    get length() {
      return items.size;
    }
    key(index: number) {
      return [...items.keys()][index] ?? null;
    }
    getItem(key: string) {
      return items.get(String(key)) ?? null;
    }
    setItem(key: string, value: string) {
      const oldValue = this.getItem(key);
      items.set(String(key), String(value));
      broadcast(this.owner, String(key), oldValue, String(value));
    }
    removeItem(key: string) {
      const oldValue = this.getItem(key);
      if (oldValue === null) return;
      items.delete(String(key));
      broadcast(this.owner, String(key), oldValue, null);
    }
    clear() {
      items.clear();
      broadcast(this.owner, null, null, null);
    }
  }

  return {
    attach(win: Window) {
      windows.add(win);
      return new WindowStorage(win);
    },
    peek: (key: string) => items.get(key) ?? null
  };
}

type Tab = ReturnType<typeof openTab>;

/**
 * A separate happy-dom Window (its own document, navigator and event target)
 * on the shared origin. happy-dom windows share one JavaScript realm, so
 * built-in classes such as Event are the same objects in both. Each window gets its
 * own LockManager object backed by the one origin lock coordinator, and its
 * own Storage object backed by the one origin store. Recovery is bound to
 * this window only.
 */
function openTab(storage: ReturnType<typeof createOriginStorage>, coordinator: LockCoordinator) {
  const win = new Window({ url: `${origin}/checkout` });
  const localStorage = storage.attach(win);
  const locks = { request: (...args: Parameters<LockCoordinator["manager"]["request"]>) => coordinator.manager.request(...args) };
  Object.defineProperty(win, "localStorage", { configurable: true, value: localStorage });
  Object.defineProperty(win, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(win.navigator, "locks", { configurable: true, value: locks });
  const changeEvents: string[] = [];
  const storageEvents: Array<string | null> = [];
  win.addEventListener(checkoutIntentChangeEvent, () => changeEvents.push(checkoutIntentChangeEvent));
  win.addEventListener("storage", (event) => storageEvents.push((event as unknown as StorageEvent).newValue));
  const recovery = createCheckoutRecovery(() => win as unknown as CheckoutRecoveryHost);
  return { win, localStorage, recovery, changeEvents, storageEvents };
}

let storage: ReturnType<typeof createOriginStorage>;
let coordinator: LockCoordinator;
let first: Tab;
let second: Tab;

beforeEach(() => {
  storage = createOriginStorage();
  coordinator = createLockCoordinator();
  first = openTab(storage, coordinator);
  second = openTab(storage, coordinator);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await first.win.happyDOM.close();
  await second.win.happyDOM.close();
});

/** What checkout does on start: claim the pointer, then the payment side effect, all under the lock. */
function startIn(tab: Tab, record: CheckoutIntentRecord, payment: Promise<void>, sideEffects: string[]) {
  return tab.recovery.withCheckoutLock(async () => {
    const stored = tab.recovery.storeCheckoutIntent(record);
    if (stored !== "stored") return stored;
    sideEffects.push(`${record.orderRef}|${record.idempotencyKey}`);
    await payment;
    return "started" as const;
  });
}

describe("checkout recovery in separate windows of one origin", () => {
  it("runs in two distinct windows that share durable storage but receive their own events", async () => {
    expect(first.win).not.toBe(second.win);
    expect(first.win.document).not.toBe(second.win.document);
    expect(first.win.navigator).not.toBe(second.win.navigator);
    expect(first.localStorage).not.toBe(second.localStorage);

    const record = intent("SKY2610-SHARED", "checkout_shared_key_0001");
    await expect(first.recovery.withCheckoutLock(async () => first.recovery.storeCheckoutIntent(record))).resolves.toEqual({
      status: "held",
      value: "stored"
    });

    expect(second.recovery.readCheckoutIntentSlot()).toEqual({ kind: "intent", record });
    // The writer hears only its own change event; the other window only a storage event.
    expect(first.changeEvents).toEqual([checkoutIntentChangeEvent]);
    expect(second.changeEvents).toEqual([]);
    expect(first.storageEvents).toEqual([]);
    await nextTask();
    expect(second.storageEvents).toEqual([raw(record)]);
    expect(first.storageEvents).toEqual([]);
  });

  it("lets only one of two windows claiming different orders at once start a payment, holding the lock through it", async () => {
    const payment = deferred();
    const sideEffects: string[] = [];
    const a = intent("SKY2610-FIRST", "checkout_first_key_00001");
    const b = intent("SKY2610-SECOND", "checkout_second_key_0001");

    const firstStart = startIn(first, a, payment.promise, sideEffects);
    const secondStart = startIn(second, b, payment.promise, sideEffects);

    await expect(secondStart).resolves.toEqual({ status: "busy" });
    expect(coordinator.contended(checkoutLockName)).toBe(1);
    // The winner still holds the lock while its payment request is open.
    expect(coordinator.isHeld(checkoutLockName)).toBe(true);
    expect(sideEffects).toEqual([`${a.orderRef}|${a.idempotencyKey}`]);
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(a));

    payment.resolve();
    await expect(firstStart).resolves.toEqual({ status: "held", value: "started" });
    expect(coordinator.isHeld(checkoutLockName)).toBe(false);

    // Once free, the other window's claim finds the winner's pointer and stops.
    await expect(startIn(second, b, Promise.resolve(), sideEffects)).resolves.toEqual({ status: "held", value: "occupied" });
    expect(sideEffects).toEqual([`${a.orderRef}|${a.idempotencyKey}`]);
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(a));
  });

  it("keeps the original identity when the same payment is claimed again from either window, writing nothing", async () => {
    const record = intent("SKY2610-RESUME", "checkout_resume_key_0001");
    await first.recovery.withCheckoutLock(async () => first.recovery.storeCheckoutIntent(record));
    const firstWrites = vi.spyOn(first.localStorage, "setItem");
    const secondWrites = vi.spyOn(second.localStorage, "setItem");
    const sideEffects: string[] = [];
    const payment = deferred();

    const held = startIn(first, record, payment.promise, sideEffects);
    await expect(startIn(second, record, Promise.resolve(), sideEffects)).resolves.toEqual({ status: "busy" });
    payment.resolve();
    await expect(held).resolves.toEqual({ status: "held", value: "started" });
    await expect(startIn(second, record, Promise.resolve(), sideEffects)).resolves.toEqual({ status: "held", value: "started" });

    expect(sideEffects).toEqual([`${record.orderRef}|${record.idempotencyKey}`, `${record.orderRef}|${record.idempotencyKey}`]);
    expect(firstWrites).not.toHaveBeenCalled();
    expect(secondWrites).not.toHaveBeenCalled();
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(record));
  });

  it("never lets a stale clear from one window remove the pointer another window replaced", async () => {
    const old = intent("SKY2610-SAME", "checkout_same_key_old01");
    const replacement = intent("SKY2610-SAME", "checkout_same_key_new01");
    await first.recovery.withCheckoutLock(async () => first.recovery.storeCheckoutIntent(old));

    // The second window settles the old payment and starts the next one.
    await second.recovery.withCheckoutLock(async () => {
      expect(second.recovery.clearCheckoutIntent(old)).toBe("cleared");
      expect(second.recovery.storeCheckoutIntent(replacement)).toBe("stored");
    });

    // The first window's late settlement still carries the old full identity.
    await expect(first.recovery.clearCheckoutIntentLocked(old)).resolves.toBe("different");
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(replacement));

    // While the second window holds the lock, even an exact clear is refused, not queued.
    const working = deferred();
    const held = second.recovery.withCheckoutLock(() => working.promise);
    await vi.waitFor(() => expect(coordinator.isHeld(checkoutLockName)).toBe(true));
    await expect(first.recovery.clearCheckoutIntentLocked(replacement)).resolves.toBe("busy");
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(replacement));
    working.resolve();
    await held;
  });

  it("reports a clear as failed when the value is removed but its read-back throws", async () => {
    const record = intent("SKY2610-HALF", "checkout_half_key_00001");
    await first.recovery.withCheckoutLock(async () => first.recovery.storeCheckoutIntent(record));
    const read = first.localStorage.getItem.bind(first.localStorage);
    let armed = false;
    const remove = first.localStorage.removeItem.bind(first.localStorage);
    vi.spyOn(first.localStorage, "removeItem").mockImplementation((key) => {
      remove(key);
      armed = true;
    });
    vi.spyOn(first.localStorage, "getItem").mockImplementation((key) => {
      if (!armed) return read(key);
      armed = false;
      throw new DOMException("Blocked", "SecurityError");
    });

    await expect(first.recovery.clearCheckoutIntentLocked(record)).resolves.toBe("failed");
    // The value really is gone, which is why the page must keep its own unverified-clear guard.
    expect(second.recovery.readCheckoutIntentSlot()).toEqual({ kind: "empty" });
  });

  it.each([
    ["the lock request rejects", "reject"],
    ["another window holds the lock (ifAvailable grants null)", "busy"],
    ["the window has no Web Locks", "missing"],
    ["the window is not a secure context", "insecure"]
  ] as const)("runs no claim or payment and keeps stored data when %s", async (_label, fault) => {
    const foreign = intent("SKY2610-KEEP", "checkout_keep_key_00001");
    await second.recovery.withCheckoutLock(async () => second.recovery.storeCheckoutIntent(foreign));
    const writes = vi.spyOn(first.localStorage, "setItem");
    const removes = vi.spyOn(first.localStorage, "removeItem");
    let release: (() => Promise<void>) | undefined;
    if (fault === "reject") coordinator.rejectRequests(new DOMException("Denied", "SecurityError"));
    if (fault === "busy") release = await coordinator.hold(checkoutLockName);
    if (fault === "missing") Object.defineProperty(first.win.navigator, "locks", { configurable: true, value: undefined });
    if (fault === "insecure") Object.defineProperty(first.win, "isSecureContext", { configurable: true, value: false });
    const work = vi.fn(async () => "ran");

    const outcome = await first.recovery.withCheckoutLock(work);
    const cleared = await first.recovery.clearCheckoutIntentLocked(foreign);

    expect(outcome).toEqual({ status: fault === "busy" ? "busy" : "unavailable" });
    expect(cleared).toBe(fault === "busy" ? "busy" : "unavailable");
    expect(work).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(storage.peek(checkoutIntentStorageKey)).toBe(raw(foreign));
    await release?.();
  });
});

describe("checkout recovery bound to the page's own window", () => {
  it("fails closed when there is no browser window rather than using a stand-in", async () => {
    expect(typeof window).toBe("undefined");
    const work = vi.fn(async () => "ran");
    expect(readCheckoutIntentSlot()).toEqual({ kind: "unreadable" });
    await expect(withCheckoutLock(work)).resolves.toEqual({ status: "unavailable" });
    expect(work).not.toHaveBeenCalled();
  });
});
