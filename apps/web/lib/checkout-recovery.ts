/**
 * Online checkout payment recovery for one browser.
 *
 * One origin-wide exclusive Web Lock serializes every change to the stored
 * payment pointer across tabs: starting a payment, and clearing it after an
 * authoritative outcome. localStorage only keeps the durable pointer so a
 * reload, a Stripe return or another tab comes back to the same order; its
 * compare-before-write/clear checks are only meaningful while the lock is held.
 */

/** The one card payment this browser started. Never an email, name, code or URL. */
export type CheckoutIntentRecord = { version: 1; orderRef: string; idempotencyKey: string };

export type CheckoutIntentSlot =
  | { kind: "empty" }
  | { kind: "intent"; record: CheckoutIntentRecord }
  // Storage that cannot be read or does not parse may still point at a
  // payable order, so it is never treated as "no payment".
  | { kind: "unreadable" }
  | { kind: "corrupt" };

export const checkoutIntentStorageKey = "skyla.checkout.paymentIntent.v1";
export const checkoutIntentChangeEvent = "skyla:checkout-payment-intent";
export const checkoutLockName = "skyla:checkout-payment";
const unreadableSnapshot = "\u0000unreadable";
const storedIdempotencyKeyPattern = /^[A-Za-z0-9_-]{12,96}$/;

export function parseCheckoutIntentSnapshot(raw: string | null): CheckoutIntentSlot {
  if (raw === null) return { kind: "empty" };
  if (raw === unreadableSnapshot) return { kind: "unreadable" };
  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutIntentRecord> | null;
    if (
      parsed?.version === 1 &&
      typeof parsed.orderRef === "string" &&
      parsed.orderRef.length > 0 &&
      parsed.orderRef.length <= 80 &&
      typeof parsed.idempotencyKey === "string" &&
      storedIdempotencyKeyPattern.test(parsed.idempotencyKey)
    ) {
      return { kind: "intent", record: { version: 1, orderRef: parsed.orderRef, idempotencyKey: parsed.idempotencyKey } };
    }
  } catch {
    // Falls through: a nonempty value we cannot parse stays unresolved.
  }
  return { kind: "corrupt" };
}

type CheckoutIdentity = Pick<CheckoutIntentRecord, "orderRef" | "idempotencyKey">;

/** Same order and same key; an order reference alone is never enough. */
export function sameCheckoutIntent(a: CheckoutIdentity, b: CheckoutIdentity) {
  return a.orderRef === b.orderRef && a.idempotencyKey === b.idempotencyKey;
}

export type StoreCheckoutIntentResult = "stored" | "occupied" | "corrupt" | "failed";
export type ClearCheckoutIntentResult = "cleared" | "already_empty" | "different" | "failed";

type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<unknown>;
};

export type CheckoutLockOutcome<T> =
  | { status: "held"; value: T }
  // Another tab holds the checkout lock right now; nothing ran.
  | { status: "busy" }
  // No usable Web Locks in this browser; nothing ran.
  | { status: "unavailable" };

/** The one window (and its navigator) whose storage and locks recovery uses. */
export type CheckoutRecoveryHost = Pick<
  Window,
  "localStorage" | "isSecureContext" | "navigator" | "addEventListener" | "removeEventListener" | "dispatchEvent"
> & { Event: typeof Event };

/**
 * Binds recovery to a window. The app uses the exports below, bound to the
 * page's own global window; tests bind separate windows to prove isolation.
 */
export function createCheckoutRecovery(currentHost: () => CheckoutRecoveryHost | null) {
  function host() {
    const found = currentHost();
    if (!found) throw new Error("Checkout recovery needs a browser window");
    return found;
  }

  /** Stable snapshot for useSyncExternalStore: the raw value or an unreadable marker. */
  function readCheckoutIntentSnapshot(): string | null {
    try {
      return host().localStorage.getItem(checkoutIntentStorageKey);
    } catch {
      return unreadableSnapshot;
    }
  }

  function readCheckoutIntentSlot() {
    return parseCheckoutIntentSnapshot(readCheckoutIntentSnapshot());
  }

  function subscribeToCheckoutIntent(onChange: () => void) {
    const target = currentHost();
    if (!target) return () => undefined;
    target.addEventListener("storage", onChange);
    target.addEventListener(checkoutIntentChangeEvent, onChange);
    return () => {
      target.removeEventListener("storage", onChange);
      target.removeEventListener(checkoutIntentChangeEvent, onChange);
    };
  }

  // Storage events reach only other windows, so this window is told directly.
  function notifyCheckoutIntentChange() {
    const target = host();
    target.dispatchEvent(new target.Event(checkoutIntentChangeEvent));
  }

  /**
   * Stores the pointer only into an empty slot and verifies the read-back. An
   * identical pointer is left as it is. Call while holding the checkout lock.
   */
  function storeCheckoutIntent(record: CheckoutIntentRecord): StoreCheckoutIntentResult {
    const current = readCheckoutIntentSlot();
    if (current.kind === "intent") return sameCheckoutIntent(current.record, record) ? "stored" : "occupied";
    if (current.kind === "corrupt") return "corrupt";
    if (current.kind === "unreadable") return "failed";
    const raw = JSON.stringify({ version: 1, orderRef: record.orderRef, idempotencyKey: record.idempotencyKey });
    try {
      host().localStorage.setItem(checkoutIntentStorageKey, raw);
    } catch {
      return "failed";
    }
    const stored = readCheckoutIntentSnapshot() === raw;
    notifyCheckoutIntentChange();
    return stored ? "stored" : "failed";
  }

  /**
   * Removes the pointer only if it still names this exact order and key, then
   * verifies. Call while holding the checkout lock.
   */
  function clearCheckoutIntent(expected: CheckoutIntentRecord): ClearCheckoutIntentResult {
    const current = readCheckoutIntentSlot();
    if (current.kind === "empty") return "already_empty";
    if (current.kind !== "intent") return "failed";
    if (!sameCheckoutIntent(current.record, expected)) return "different";
    try {
      host().localStorage.removeItem(checkoutIntentStorageKey);
    } catch {
      return "failed";
    }
    const cleared = readCheckoutIntentSnapshot() === null;
    notifyCheckoutIntentChange();
    return cleared ? "cleared" : "failed";
  }

  function checkoutLockManager(): LockManagerLike | null {
    // Web Locks exist only in secure contexts; anything else is refused.
    const target = currentHost();
    if (!target || target.isSecureContext !== true) return null;
    const locks = (target.navigator as Navigator & { locks?: unknown }).locks as LockManagerLike | null | undefined;
    return locks && typeof locks.request === "function" ? locks : null;
  }

  /**
   * Runs `work` while holding the origin-wide checkout lock, without queueing:
   * if another tab holds it, the action is refused instead of running later.
   * The lock is held until `work` settles. Errors thrown by `work` are rethrown.
   */
  async function withCheckoutLock<T>(work: () => Promise<T>): Promise<CheckoutLockOutcome<T>> {
    const locks = checkoutLockManager();
    if (!locks) return { status: "unavailable" };
    let ran = false;
    let result: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
    try {
      await locks.request(checkoutLockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock) return;
        ran = true;
        try {
          result = { ok: true, value: await work() };
        } catch (error) {
          result = { ok: false, error };
        }
      });
    } catch {
      if (!ran) return { status: "unavailable" };
    }
    if (!ran) return { status: "busy" };
    const settled = result as { ok: true; value: T } | { ok: false; error: unknown } | null;
    if (!settled) return { status: "unavailable" };
    if (!settled.ok) throw settled.error;
    return { status: "held", value: settled.value };
  }

  /** Clears the exact pointer under its own lock, for work not already holding it. */
  async function clearCheckoutIntentLocked(
    expected: CheckoutIntentRecord
  ): Promise<ClearCheckoutIntentResult | "busy" | "unavailable"> {
    const outcome = await withCheckoutLock(async () => clearCheckoutIntent(expected));
    return outcome.status === "held" ? outcome.value : outcome.status;
  }

  return {
    readCheckoutIntentSnapshot,
    readCheckoutIntentSlot,
    subscribeToCheckoutIntent,
    storeCheckoutIntent,
    clearCheckoutIntent,
    withCheckoutLock,
    clearCheckoutIntentLocked
  };
}

export const {
  readCheckoutIntentSnapshot,
  readCheckoutIntentSlot,
  subscribeToCheckoutIntent,
  storeCheckoutIntent,
  clearCheckoutIntent,
  withCheckoutLock,
  clearCheckoutIntentLocked
} = createCheckoutRecovery(() => (typeof window === "undefined" ? null : window));

export const checkoutLockRefusalMessage = {
  busy: "Another tab is starting or checking a card payment right now. No payment was started; try again in a moment.",
  unavailable:
    "This browser can't safely coordinate card payments across tabs, so no payment was started. Open this page over a secure (https) connection in an up-to-date browser, or contact our team for help."
} as const;
