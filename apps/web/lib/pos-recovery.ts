import { checkoutEntryTimes, formatVisitDateLabel } from "@skyla/payments";

/**
 * Register sale recovery for the POS browser.
 *
 * One origin-wide Web Lock serializes every mutation that can create, pay,
 * release or forget a register sale across tabs. localStorage only holds the
 * durable pointer to the sale so a reload or crash comes back to it; it is not
 * a cross-tab compare-and-set on its own. Its compare-before-write/clear checks
 * are only meaningful while the lock is held.
 */

/** The one sale this browser is working on. Never a token, email or amount. */
export type ActiveSaleRecord = { version: 1; saleRef: string; idempotencyKey: string };

export type ActiveSaleSlot =
  | { kind: "empty" }
  | { kind: "sale"; record: ActiveSaleRecord }
  // Storage that cannot be read or does not parse may still point at a
  // payable sale, so it is never treated as "no sale".
  | { kind: "unreadable" }
  | { kind: "corrupt" };

export const activeSaleStorageKey = "skyla:pos-active-sale";
export const activeSaleChangeEvent = "skyla:pos-active-sale-change";
export const registerLockName = "skyla:pos-register-sale";
const unreadableSnapshot = "\u0000unreadable";
const storedKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;

/** Stable snapshot for useSyncExternalStore: the raw value or an unreadable marker. */
export function readActiveSaleSnapshot(): string | null {
  try {
    return window.localStorage.getItem(activeSaleStorageKey);
  } catch {
    return unreadableSnapshot;
  }
}

export function parseActiveSaleSnapshot(raw: string | null): ActiveSaleSlot {
  if (raw === null) return { kind: "empty" };
  if (raw === unreadableSnapshot) return { kind: "unreadable" };
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveSaleRecord> | null;
    if (
      parsed?.version === 1 &&
      typeof parsed.saleRef === "string" &&
      parsed.saleRef.length > 0 &&
      parsed.saleRef.length <= 80 &&
      typeof parsed.idempotencyKey === "string" &&
      storedKeyPattern.test(parsed.idempotencyKey)
    ) {
      return { kind: "sale", record: { version: 1, saleRef: parsed.saleRef, idempotencyKey: parsed.idempotencyKey } };
    }
  } catch {
    // Falls through: a nonempty value we cannot parse stays unresolved.
  }
  return { kind: "corrupt" };
}

export function readActiveSaleSlot() {
  return parseActiveSaleSnapshot(readActiveSaleSnapshot());
}

export function subscribeToActiveSale(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(activeSaleChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(activeSaleChangeEvent, onChange);
  };
}

export function sameSale(a: ActiveSaleRecord, b: ActiveSaleRecord) {
  return a.saleRef === b.saleRef && a.idempotencyKey === b.idempotencyKey;
}

function notifyActiveSaleChange() {
  window.dispatchEvent(new Event(activeSaleChangeEvent));
}

export type StoreActiveSaleResult = "stored" | "occupied" | "failed";

/**
 * Stores the pointer only into an empty slot and verifies the read-back.
 * Call while holding the register lock.
 */
export function storeActiveSale(record: ActiveSaleRecord): StoreActiveSaleResult {
  const current = readActiveSaleSlot();
  if (current.kind === "sale" && sameSale(current.record, record)) return "stored";
  if (current.kind === "sale" || current.kind === "corrupt") return "occupied";
  if (current.kind === "unreadable") return "failed";
  const raw = JSON.stringify(record);
  try {
    window.localStorage.setItem(activeSaleStorageKey, raw);
  } catch {
    return "failed";
  }
  const stored = readActiveSaleSnapshot() === raw;
  notifyActiveSaleChange();
  return stored ? "stored" : "failed";
}

export type ClearActiveSaleResult = "cleared" | "already_empty" | "different_sale" | "failed";

/**
 * Removes the pointer only if it still names this exact sale, then verifies.
 * Call while holding the register lock.
 */
export function clearActiveSale(expected: ActiveSaleRecord): ClearActiveSaleResult {
  const current = readActiveSaleSlot();
  if (current.kind === "empty") return "already_empty";
  if (current.kind === "unreadable") return "failed";
  if (current.kind !== "sale" || !sameSale(current.record, expected)) return "different_sale";
  try {
    window.localStorage.removeItem(activeSaleStorageKey);
  } catch {
    return "failed";
  }
  const cleared = readActiveSaleSnapshot() === null;
  notifyActiveSaleChange();
  return cleared ? "cleared" : "failed";
}

type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<unknown>;
};

function registerLockManager(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: unknown }).locks as LockManagerLike | null | undefined;
  return locks && typeof locks.request === "function" ? locks : null;
}

export type RegisterLockOutcome<T> =
  | { status: "held"; value: T }
  // Another tab holds the register lock right now; nothing ran.
  | { status: "busy" }
  // No usable Web Locks in this browser; nothing ran.
  | { status: "unavailable" };

/**
 * Runs `work` while holding the origin-wide register lock, without queueing:
 * if another tab holds it, the action is refused instead of running later.
 * Errors thrown by `work` are rethrown to the caller.
 */
export async function withRegisterLock<T>(work: () => Promise<T>): Promise<RegisterLockOutcome<T>> {
  const locks = registerLockManager();
  if (!locks) return { status: "unavailable" };
  let ran = false;
  let result: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
  try {
    await locks.request(registerLockName, { mode: "exclusive", ifAvailable: true }, async (lock) => {
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

export const lockRefusalMessage = {
  busy: "Another register tab is working on a sale right now. Nothing was sent; try again when it finishes.",
  unavailable: "This browser cannot safely coordinate register tabs, so it will not start or change a sale. Nothing was sent."
} as const;

/** Sale outcome fields the status route reports; ticket fields may be absent on older backends. */
export type SaleOutcome = {
  saleRef: string;
  paymentState:
    | "draft"
    | "starting"
    | "awaiting_payment"
    | "unknown"
    | "paid"
    | "paid_needs_attention"
    | "canceled"
    | "closed"
    | "refunded";
  visitDate?: string;
  entryTime?: string;
  party?: { total: number };
  bookingRef?: string;
  ticketCode?: string;
  bookingStatus?: string;
  ticketIssued?: boolean;
  admissionUsed?: boolean;
};

export type TicketStanding = "none" | "usable" | "used" | "cancelled" | "expired" | "unconfirmed";

function entryRecorded(status: SaleOutcome) {
  return status.admissionUsed === true || status.bookingStatus === "checked-in";
}

/**
 * What the stored evidence proves for entry. Recorded entry is immutable and
 * wins even without delivery fields; otherwise only a settled paid sale with
 * an issued, confirmed, unused ticket can be usable. Anything else is unconfirmed.
 */
export function ticketStanding(status: SaleOutcome, today: string): TicketStanding {
  const admission = Boolean(status.visitDate || (status.party && status.party.total > 0));
  if (!admission) return "none";
  if (entryRecorded(status)) return "used";
  if (status.paymentState !== "paid") return "unconfirmed";
  if (status.bookingStatus === "cancelled") return "cancelled";
  if (status.ticketIssued !== true || status.admissionUsed !== false || status.bookingStatus !== "confirmed") return "unconfirmed";
  if (!today || !status.visitDate) return "unconfirmed";
  if (status.visitDate < today) return "expired";
  return "usable";
}

function bookingName(status: SaleOutcome) {
  return status.bookingRef ? `Booking ${status.bookingRef}` : "The booking";
}

function visitName(status: SaleOutcome) {
  return status.visitDate ? formatVisitDateLabel(status.visitDate) : "its visit date";
}

function entryName(status: SaleOutcome) {
  const label = checkoutEntryTimes.find((slot) => slot.value === status.entryTime)?.label ?? status.entryTime;
  return label ? `entry from ${label} through closing` : "entry through closing";
}

export function saleStatusMessage(status: SaleOutcome, today: string): string {
  switch (status.paymentState) {
    case "draft":
      return "Reviewed. Send it to the reader when the guest is ready.";
    case "starting":
      return "Starting the payment. Do not charge again; use Refresh Status if this stays.";
    case "awaiting_payment":
      return "Waiting for the card on the reader. If the reader declined, send the same payment again.";
    case "unknown":
      return "Payment outcome not confirmed. Do not charge again; use Refresh Status.";
    case "paid": {
      const standing = ticketStanding(status, today);
      switch (standing) {
        case "none":
          return "Paid. Receipt is ready.";
        case "usable":
          return `Paid. ${bookingName(status)} has an issued ticket for ${visitName(status)}, ${entryName(status)}, no re-entry.`;
        case "used":
          return `Paid. ${bookingName(status)} was already used for entry. No re-entry.`;
        case "cancelled":
          return `Paid. ${bookingName(status)} is cancelled, so its ticket cannot be used for entry.`;
        case "expired":
          return `Paid. ${bookingName(status)} was for ${visitName(status)}, which has passed, so its ticket cannot be used for entry.`;
        case "unconfirmed":
          return `Paid. Do not charge again. The ticket for ${status.bookingRef ? `booking ${status.bookingRef}` : "this sale"} is not confirmed; check it before admitting anyone.`;
      }
      return "Paid.";
    }
    case "paid_needs_attention": {
      const ticket = entryRecorded(status)
        ? "Admission was already used for entry. No re-entry."
        : status.ticketIssued === true
          ? `A ticket exists for ${status.bookingRef ? `booking ${status.bookingRef}` : "this sale"}, but do not admit on it until staff resolve this.`
          : "No usable ticket is confirmed; do not admit on this sale until staff resolve it.";
      return `Paid, but it needs staff review. Do not charge again. ${ticket}`;
    }
    case "canceled":
      return "Payment canceled. The guest was not charged.";
    case "closed":
      return "This sale closed without payment.";
    case "refunded":
      return entryRecorded(status)
        ? "This sale was paid and then refunded. Admission was already used for entry. No re-entry."
        : "This sale was paid and then refunded. Do not admit on it without checking the booking.";
  }
}
