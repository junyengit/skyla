"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import {
  admissionAgeCategories,
  admissionMaxPartySize,
  checkoutEntryTimes,
  formatVisitDateLabel,
  parseVisitDate,
  parseVisitTime,
  venueToday,
  type CafeItemKey
} from "@skyla/payments";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";
import { useStaffSession } from "@/components/staff-auth-provider";
import {
  clearActiveSale,
  lockRefusalMessage,
  parseActiveSaleSnapshot,
  readActiveSaleSlot,
  readActiveSaleSnapshot,
  saleStatusMessage,
  sameSale,
  storeActiveSale,
  subscribeToActiveSale,
  ticketStanding,
  withRegisterLock,
  type ActiveSaleRecord,
  type SaleOutcome
} from "@/lib/pos-recovery";
import { parseVisitAvailability, type VisitAvailability } from "@/lib/visit-availability";

type CafeOption = {
  key: CafeItemKey;
  name: string;
  priceCents: number;
  category: "matcha" | "coffee" | "bites";
};

type CartLine =
  | { id: string; kind: "cafe"; itemKey: CafeItemKey; name: string; quantity: number }
  | { id: string; kind: "custom"; name: string; amountCents: number; quantity: number; reason: string };

type AgeCounts = { adults: number; youths: number; children: number };

type DraftLine = {
  kind: string;
  productKey?: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
};

type PosDraftResponse = {
  draft: {
    status: "draft";
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
    saleRef?: string;
    readerId?: string;
    visitDate?: string;
    entryTime?: string;
    lines: DraftLine[];
  };
  saleRef?: string;
  persisted: boolean;
  persistenceReason?: "convex_unconfigured" | "idempotencyKey_required" | "staff_auth_required";
};

type PaymentState = SaleOutcome["paymentState"];

type SaleRecordStatus = "draft" | "payment_pending" | "paid" | "canceled" | "expired";

/** The status route's projection, as validated by `parseSaleStatus`. */
type PosSaleStatusResponse = SaleOutcome & {
  status: SaleRecordStatus;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  party?: { adults: number; youths: number; children: number; total: number };
  lines: DraftLine[];
  readerId?: string;
  readerRetryAllowed: boolean;
  lastReaderStatus?: string;
  ticketIssued: boolean;
  admissionUsed: boolean;
};

const saleRecordStatuses = new Set<string>(["draft", "payment_pending", "paid", "canceled", "expired"]);
const paymentStates = new Set<string>([
  "draft",
  "starting",
  "awaiting_payment",
  "unknown",
  "paid",
  "paid_needs_attention",
  "canceled",
  "closed",
  "refunded"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Absent, or a string matching `pattern` when one is given. */
function optionalText(value: unknown, pattern?: RegExp): value is string | undefined {
  return value === undefined || (typeof value === "string" && (!pattern || pattern.test(value)));
}

function parseStatusLine(value: unknown): DraftLine | null {
  if (!isRecord(value)) return null;
  const { kind, name, quantity, unitAmountCents, lineTotalCents } = value;
  if (
    typeof kind !== "string" ||
    !kind ||
    typeof name !== "string" ||
    !isCount(quantity) ||
    quantity < 1 ||
    !isCount(unitAmountCents) ||
    !isCount(lineTotalCents)
  ) {
    return null;
  }
  return { kind, name, quantity, unitAmountCents, lineTotalCents };
}

/**
 * Runtime boundary for a 200 status answer. Anything outside the route's
 * contract is not authority: it returns null, and the caller keeps the
 * pointer, any pending change and the lock in place.
 */
function parseSaleStatus(value: unknown, saleRef: string): PosSaleStatusResponse | null {
  if (!isRecord(value)) return null;
  const v = value;
  if (
    v.saleRef !== saleRef ||
    typeof v.status !== "string" ||
    !saleRecordStatuses.has(v.status) ||
    typeof v.paymentState !== "string" ||
    !paymentStates.has(v.paymentState) ||
    v.currency !== "usd" ||
    !isCount(v.subtotalCents) ||
    !isCount(v.feeCents) ||
    !isCount(v.totalCents) ||
    !Array.isArray(v.lines) ||
    typeof v.readerRetryAllowed !== "boolean" ||
    typeof v.ticketIssued !== "boolean" ||
    typeof v.admissionUsed !== "boolean"
  ) {
    return null;
  }
  const lines = v.lines.map(parseStatusLine);
  if (lines.some((line) => line === null)) return null;
  if (
    (v.visitDate !== undefined && parseVisitDate(v.visitDate) === null) ||
    (v.entryTime !== undefined && parseVisitTime(v.entryTime) === null) ||
    !optionalText(v.readerId) ||
    !optionalText(v.lastReaderStatus) ||
    !optionalText(v.bookingRef) ||
    !optionalText(v.bookingStatus) ||
    !optionalText(v.ticketCode, /^tkt_[a-f0-9]{32}$/)
  ) {
    return null;
  }
  let party: PosSaleStatusResponse["party"];
  if (v.party !== undefined) {
    if (!isRecord(v.party)) return null;
    const { adults, youths, children, total } = v.party;
    if (!isCount(adults) || !isCount(youths) || !isCount(children) || !isCount(total)) return null;
    party = { adults, youths, children, total };
  }
  return {
    saleRef,
    status: v.status as SaleRecordStatus,
    paymentState: v.paymentState as PaymentState,
    currency: "usd",
    subtotalCents: v.subtotalCents,
    feeCents: v.feeCents,
    totalCents: v.totalCents,
    visitDate: v.visitDate as string | undefined,
    entryTime: v.entryTime as string | undefined,
    party,
    lines: lines as DraftLine[],
    readerId: v.readerId,
    readerRetryAllowed: v.readerRetryAllowed,
    lastReaderStatus: v.lastReaderStatus,
    bookingRef: v.bookingRef,
    bookingStatus: v.bookingStatus,
    ticketIssued: v.ticketIssued,
    admissionUsed: v.admissionUsed,
    ticketCode: v.ticketCode
  };
}

type TerminalReaderOption = {
  label: string;
  readerId: string;
  terminalLocationId?: string;
};

type TerminalReadersResponse = {
  staff: { emailLower: string; role: "admin" | "pos" };
  readers: TerminalReaderOption[];
};

type PosDraftClientProps = {
  cafeItems: CafeOption[];
  terminalAccepted: boolean;
};

const catalogTabs = ["admission", "cafe", "custom"] as const;
type Tab = (typeof catalogTabs)[number];

type Busy = "review" | "pay" | "reader" | "readers" | "refresh" | "release" | "finish";

/**
 * A change this tab or another tab may be making to the sale. It replaces the
 * last known draft authority until a status read made while holding the
 * register lock succeeds, so no other tab can be mid-write behind that read.
 * `contended`: another tab held the lock; `stale`: the sale could not be
 * re-read before acting.
 */
type PendingChange = {
  saleRef: string;
  action: "payment" | "release" | "contended" | "stale";
  phase: "sending" | "checking" | "unconfirmed";
};

type ReleaseResult = "released" | "refused";

// Only an authoritative outcome frees the register for another sale.
const finishedStates = new Set<PaymentState>(["paid", "paid_needs_attention", "canceled", "closed", "refunded"]);
const pollingStates = new Set<PaymentState>(["starting", "awaiting_payment", "unknown"]);
const entryTimeLabels = new Map<string, string>(checkoutEntryTimes.map((slot) => [slot.value, slot.label]));

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pos_${crypto.randomUUID()}`;
  }
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function customCents(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
}

function readerOptionKey(option: TerminalReaderOption) {
  return `${option.readerId}@${option.terminalLocationId ?? ""}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

const noSubscription = () => () => {};
// The register's LA calendar date, read on the device at render time.
const readVenueToday = () => venueToday(Date.now());
const serverVenueToday = () => "";

function partyDescription(counts: AgeCounts) {
  return [
    counts.adults ? `${counts.adults} adult${counts.adults === 1 ? "" : "s"}` : "",
    counts.youths ? `${counts.youths} youth${counts.youths === 1 ? "" : "s"}` : "",
    counts.children ? `${counts.children} child${counts.children === 1 ? "" : "ren"} free` : ""
  ]
    .filter(Boolean)
    .join(", ");
}

function visitLabel(visitDate?: string, entryTime?: string) {
  if (!visitDate || !entryTime) return "";
  return `${formatVisitDateLabel(visitDate)} · ${entryTimeLabels.get(entryTime) ?? entryTime}`;
}

function pendingMessage(pending: PendingChange) {
  if (pending.action === "contended") {
    return "Another register tab is working on this sale. Do not charge again from here; use Refresh Status after it finishes.";
  }
  if (pending.action === "stale") {
    return "This sale's current status could not be confirmed, so nothing was sent. Use Refresh Status.";
  }
  if (pending.action === "release") {
    return pending.phase === "unconfirmed"
      ? "Release not confirmed. The sale stays locked; use Refresh Status."
      : "Checking the sale with the server.";
  }
  return pending.phase === "sending"
    ? "Sending the payment to the reader. Do not charge again."
    : pending.phase === "checking"
      ? "Checking the payment with the server. Do not charge again."
      : "Payment outcome not confirmed. Do not charge again; use Refresh Status.";
}

type PosSaleOutcomeProps = {
  /** Authoritative server status, or undefined while none is confirmed. */
  status?: SaleOutcome & { totalCents: number };
  /** Venue date (YYYY-MM-DD) used to decide whether a ticket's visit has passed. */
  today: string;
  message: string;
  attention: boolean;
};

/**
 * Paid receipt and live status for the register sale. Pure: the admission
 * ticket link appears only when stored evidence shows an unused, confirmed
 * ticket for a visit that has not passed.
 */
export function PosSaleOutcome({ status, today, message, attention }: PosSaleOutcomeProps) {
  const usableTicket = status?.paymentState === "paid" && status.ticketCode && ticketStanding(status, today) === "usable";
  return (
    <>
      {status?.paymentState === "paid" ? (
        <div className="posNextReceipt" aria-label="Paid sale receipt">
          <div>
            <span>Paid total</span>
            <strong>{money(status.totalCents)}</strong>
          </div>
          {status.bookingRef ? <p>Booking {status.bookingRef}</p> : null}
          {usableTicket ? (
            <Link href={`/tickets/${status.ticketCode}`} target="_blank" rel="noreferrer">
              Open admission ticket
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className={`posNextPayment${attention ? " isAttention" : ""}`} role="status" aria-live="polite" aria-atomic="true">
        {message || null}
      </div>
    </>
  );
}

export function PosDraftClient({ cafeItems, terminalAccepted }: PosDraftClientProps) {
  const staffSession = useStaffSession();
  const pathname = usePathname();
  const signedIn = staffSession.status === "signed-in";
  const today = useSyncExternalStore(noSubscription, readVenueToday, serverVenueToday);
  const catalogId = useId();
  const catalogTabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [activeTab, setActiveTab] = useState<Tab>("admission");
  const [counts, setCounts] = useState<AgeCounts>({ adults: 0, youths: 0, children: 0 });
  const [chosenVisitDate, setVisitDate] = useState("");
  // Defaults to today in Los Angeles until the cashier picks another date.
  const visitDate = chosenVisitDate || today;
  const [entryTime, setEntryTime] = useState("");
  const [availabilityState, setAvailabilityState] = useState<
    { key: string; status: "ready"; data: VisitAvailability } | { key: string; status: "error" } | null
  >(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [readerOptions, setReaderOptions] = useState<TerminalReaderOption[]>([]);
  const [selectedReaderKey, setSelectedReaderKey] = useState("");
  const [readerMessage, setReaderMessage] = useState<string | null>(null);
  const [authorizedStaff, setAuthorizedStaff] = useState<TerminalReadersResponse["staff"] | null>(null);
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [preview, setPreview] = useState<PosDraftResponse | null>(null);
  const [saleStatus, setSaleStatus] = useState<PosSaleStatusResponse | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  // A reviewed sale this browser could not save: it stays locked here with
  // payment off until its release is confirmed.
  const [unsavedSale, setUnsavedSale] = useState<ActiveSaleRecord | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set synchronously before any await so a second event in the same frame
  // is refused before React re-renders the disabled controls.
  const actionRef = useRef<{ kind: Busy } | null>(null);
  const authEpochRef = useRef(0);
  const pollVersionRef = useRef(0);

  const storedSaleRaw = useSyncExternalStore(subscribeToActiveSale, readActiveSaleSnapshot, () => null);
  const storedSlot = useMemo(() => parseActiveSaleSnapshot(storedSaleRaw), [storedSaleRaw]);
  const storedSale = storedSlot.kind === "sale" ? storedSlot.record : null;
  const activeSale = storedSale ?? (storedSlot.kind === "empty" ? unsavedSale : null);
  // Only a sale whose pointer survived storage can take payment here.
  const durable = storedSale !== null;
  const currentStatus = activeSale && saleStatus?.saleRef === activeSale.saleRef ? saleStatus : null;
  const currentPending = activeSale && pending?.saleRef === activeSale.saleRef ? pending : null;
  const paymentState: PaymentState | undefined = currentPending ? "unknown" : currentStatus?.paymentState;
  // Any stored, unreadable or damaged pointer locks the cart; only an audited
  // draft release or an authoritative outcome unlocks it.
  const locked = storedSlot.kind !== "empty" || unsavedSale !== null;
  const finished = paymentState !== undefined && finishedStates.has(paymentState);
  const editLocked = locked || busy !== null;

  const partySize = counts.adults + counts.youths + counts.children;
  const hasAdmission = partySize > 0;
  const validVisitDate = parseVisitDate(visitDate);
  const admissionCents =
    counts.adults * admissionAgeCategories.adult.priceCents + counts.youths * admissionAgeCategories.youth.priceCents;
  const cartCents = cart.reduce((sum, line) => {
    const unit = line.kind === "custom" ? line.amountCents : cafeItems.find((item) => item.key === line.itemKey)?.priceCents ?? 0;
    return sum + unit * line.quantity;
  }, 0);
  const previewCents = admissionCents + cartCents;

  const selectedReader = useMemo(
    () => readerOptions.find((option) => readerOptionKey(option) === selectedReaderKey),
    [readerOptions, selectedReaderKey]
  );

  const availabilityKey = hasAdmission && validVisitDate && !locked ? `${validVisitDate}|${partySize}` : null;
  useEffect(() => {
    if (!availabilityKey || !validVisitDate) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ date: validVisitDate, party: String(partySize) });
        const response = await fetch(`/api/availability?${params}`, { cache: "no-store", signal: controller.signal });
        const parsed = response.ok ? parseVisitAvailability(await response.json()) : null;
        if (controller.signal.aborted) return;
        setAvailabilityState(
          parsed && parsed.visitDate === validVisitDate && parsed.partySize === partySize
            ? { key: availabilityKey, status: "ready", data: parsed }
            : { key: availabilityKey, status: "error" }
        );
      } catch {
        if (!controller.signal.aborted) setAvailabilityState({ key: availabilityKey, status: "error" });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [availabilityKey, validVisitDate, partySize]);
  const availability =
    availabilityState?.key === availabilityKey && availabilityState.status === "ready" ? availabilityState.data : undefined;
  const availabilityFailed = availabilityState?.key === availabilityKey && availabilityState.status === "error";
  const selectedSlot = availability?.slots.find((slot) => slot.entryTime === entryTime);

  useEffect(() => {
    const epochRef = authEpochRef;
    const pollRef = pollVersionRef;
    return () => {
      epochRef.current += 1;
      pollRef.current += 1;
    };
  }, []);

  // A reload or new staff session returns to the stored sale from the
  // authoritative server state; nothing about money is trusted locally.
  const restoreSaleRef =
    signedIn && storedSale && saleStatus?.saleRef !== storedSale.saleRef ? storedSale.saleRef : null;
  useEffect(() => {
    if (!restoreSaleRef) return;
    void loadStatus(restoreSaleRef, authEpochRef.current, { poll: true });
    // loadStatus only reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreSaleRef]);

  function beginAction(kind: Busy) {
    if (actionRef.current) return null;
    const token = { kind };
    actionRef.current = token;
    setBusy(kind);
    return token;
  }

  function endAction(token: { kind: Busy }) {
    if (actionRef.current !== token) return;
    actionRef.current = null;
    setBusy(null);
  }

  /** Cart, visit, email, reader and custom edits: refused while locked or mid-action. */
  function canEdit() {
    return !locked && actionRef.current === null;
  }

  function resetReview() {
    setPreview(null);
    setNotice(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function setCount(field: keyof AgeCounts, delta: number) {
    if (!canEdit()) return;
    setCounts((current) => {
      const next = Math.max(0, current[field] + delta);
      const others = current.adults + current.youths + current.children - current[field];
      return { ...current, [field]: Math.min(next, admissionMaxPartySize - others) };
    });
    resetReview();
  }

  function addCafeLine(item: CafeOption) {
    if (!canEdit()) return;
    const id = `cafe:${item.key}`;
    setCart((current) =>
      current.some((line) => line.id === id)
        ? current.map((line) => (line.id === id ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line))
        : [...current, { id, kind: "cafe", itemKey: item.key, name: item.name, quantity: 1 }]
    );
    resetReview();
  }

  function addCustomLine() {
    if (!canEdit()) return;
    const amountCents = customCents(customAmount);
    if (!amountCents || amountCents < 50) {
      setNotice("Custom charge must be at least $0.50.");
      return;
    }
    if (!customReason.trim()) {
      setNotice("Custom charge requires a reason.");
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `custom:${crypto.randomUUID()}`
        : `custom:${idempotencyKey}:${cart.length}:${customName.trim() || "charge"}`;
    setCart((current) => [
      ...current,
      { id, kind: "custom", name: customName.trim() || "Custom charge", amountCents, quantity: 1, reason: customReason.trim() }
    ]);
    setCustomName("");
    setCustomAmount("");
    setCustomReason("");
    resetReview();
  }

  function updateQuantity(id: string, delta: number) {
    if (!canEdit()) return;
    setCart((current) =>
      current
        .map((line) => (line.id === id ? { ...line, quantity: Math.max(0, Math.min(99, line.quantity + delta)) } : line))
        .filter((line) => line.quantity > 0)
    );
    resetReview();
  }

  function clearLocalSale() {
    setCart([]);
    setCounts({ adults: 0, youths: 0, children: 0 });
    setVisitDate("");
    setEntryTime("");
    setCustomerEmail("");
    setPreview(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function linePayload(line: CartLine) {
    if (line.kind === "cafe") {
      return { kind: "cafe" as const, itemKey: line.itemKey, quantity: line.quantity };
    }
    return { kind: "custom" as const, name: line.name, amountCents: line.amountCents, quantity: line.quantity, reason: line.reason };
  }

  async function loadTerminalReaders() {
    if (locked) return;
    const token = beginAction("readers");
    if (!token) return;
    const authEpoch = authEpochRef.current;
    setReaderMessage(null);
    try {
      const response = await staffSession.staffFetch("/api/pos/readers");
      const data = (await response.json()) as TerminalReadersResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error ?? "Could not load authorized readers" : "Could not load authorized readers");
      }
      if (authEpoch !== authEpochRef.current) return;
      const readerData = data as TerminalReadersResponse;
      const readers = readerData.readers;
      setAuthorizedStaff(readerData.staff);
      setReaderOptions(readers);
      setSelectedReaderKey((current) => {
        if (readers.some((option) => readerOptionKey(option) === current)) return current;
        return readers[0] ? readerOptionKey(readers[0]) : "";
      });
      setReaderMessage(
        readers.length > 0
          ? `${readers.length} authorized reader${readers.length === 1 ? "" : "s"} loaded.`
          : "No authorized readers are configured yet."
      );
      resetReview();
    } catch (error) {
      if (authEpoch !== authEpochRef.current) return;
      setReaderOptions([]);
      setSelectedReaderKey("");
      setReaderMessage(errorText(error, "Could not load authorized readers"));
    } finally {
      endAction(token);
    }
  }

  async function readStatus(saleRef: string, refresh: boolean) {
    const response = await staffSession.staffFetch("/api/payments/stripe-terminal/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleRef, refresh })
    });
    const data: unknown = await response.json().catch(() => null);
    if (response.status === 404) {
      // This server not knowing the sale does not prove no payment exists
      // elsewhere, so the pointer and lock stay.
      throw new Error(`The server has no record of sale ${saleRef}; it stays locked here. Check it with a manager`);
    }
    if (!response.ok) {
      throw new Error(isRecord(data) && typeof data.error === "string" && data.error ? data.error : "Could not load sale status");
    }
    const status = parseSaleStatus(data, saleRef);
    if (!status) throw new Error("The server's sale status was incomplete, so nothing about this sale changed here");
    return status;
  }

  /**
   * Reads the stored server state. With `verify`, the read is made while
   * holding the register lock and only then clears a pending change; while
   * another tab holds the lock nothing is read and the sale stays contended.
   * Failure leaves the lock in place and never infers that a sale is unpaid.
   */
  async function loadStatus(
    saleRef: string,
    authEpoch: number,
    options: { poll?: boolean; refresh?: boolean; verify?: boolean } = {}
  ) {
    const pollVersion = ++pollVersionRef.current;
    const current = () => authEpoch === authEpochRef.current && pollVersion === pollVersionRef.current;
    let verifying = options.verify === true;
    try {
      for (let attempt = 0; attempt < (options.poll ? 45 : 1); attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!current()) return;
        const refresh = options.refresh === true && attempt === 0;
        let data: PosSaleStatusResponse | null;
        if (verifying) {
          const outcome = await withRegisterLock(() => readStatus(saleRef, refresh));
          // Without Web Locks no tab here can write, so a plain read is current.
          data = outcome.status === "held" ? outcome.value : outcome.status === "unavailable" ? await readStatus(saleRef, refresh) : null;
        } else {
          data = await readStatus(saleRef, refresh);
        }
        if (!current()) return;
        if (!data) {
          setPending({ saleRef, action: "contended", phase: "unconfirmed" });
          if (!options.poll) return;
          continue;
        }
        setSaleStatus(data);
        if (verifying) {
          setPending((value) => (value?.saleRef === saleRef ? null : value));
          verifying = false;
        }
        if (!options.poll || !pollingStates.has(data.paymentState)) return;
      }
    } catch (error) {
      if (!current()) return;
      setPending((value) => (value?.saleRef === saleRef && value.phase === "checking" ? { ...value, phase: "unconfirmed" } : value));
      // Kept alongside, never replacing, the outcome of the action that led here.
      const message = `${errorText(error, "Could not load sale status")}. The sale stays locked; use Refresh Status.`;
      setNotice((value) => (value && value !== message ? `${value} ${message}` : message));
    }
  }

  async function releaseOnServer(record: ActiveSaleRecord): Promise<ReleaseResult> {
    const response = await staffSession.staffFetch("/api/pos/sale-release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleRef: record.saleRef, idempotencyKey: record.idempotencyKey })
    });
    const data = (await response.json().catch(() => ({}))) as { released?: unknown; error?: string };
    if (response.ok && data.released === true) return "released";
    if (response.ok && data.released === false) return "refused";
    throw new Error(data.error ?? "Could not release this sale");
  }

  async function reviewSale() {
    if (actionRef.current || locked) return;
    if (!hasAdmission && cart.length === 0) {
      setNotice("Add admission or items first.");
      return;
    }
    if (hasAdmission && counts.adults < 1) {
      setNotice("Admission needs at least one adult 18+.");
      return;
    }
    if (hasAdmission && (!validVisitDate || !entryTime)) {
      setNotice("Choose the visit date and entry time.");
      return;
    }
    if (selectedReaderKey && !selectedReader) {
      setNotice("Reload the authorized reader list before reviewing this sale.");
      return;
    }
    const token = beginAction("review");
    if (!token) return;
    setNotice(null);
    const authEpoch = authEpochRef.current;
    const key = idempotencyKey;
    // Frozen with the controls: the stored sale always matches what was sent.
    const party = hasAdmission ? { ...counts, total: partySize } : undefined;
    const body = JSON.stringify({
      admission: hasAdmission
        ? {
            packageKey: "general",
            adults: counts.adults,
            children: counts.youths,
            freeChildren: counts.children,
            visitDate: validVisitDate,
            entryTime
          }
        : undefined,
      lines: cart.map(linePayload),
      customerEmail: customerEmail.trim() || undefined,
      readerId: selectedReader?.readerId,
      idempotencyKey: key
    });
    try {
      const outcome = await withRegisterLock(async () => {
        if (readActiveSaleSlot().kind !== "empty") return { kind: "occupied" as const };
        let response: Response;
        try {
          response = await staffSession.staffFetch("/api/order-drafts/pos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
          });
        } catch (error) {
          return { kind: "lost" as const, error: errorText(error, "The review request failed") };
        }
        const data = (await response.json().catch(() => null)) as PosDraftResponse | { error?: string } | null;
        if (!response.ok || !data || !("draft" in data)) {
          const message = data && "error" in data && data.error ? data.error : "Could not review this sale";
          // A server error may still have stored the draft under this key.
          return response.status >= 500 || !data
            ? { kind: "lost" as const, error: message }
            : { kind: "refused" as const, error: message };
        }
        if (!data.persisted || !data.saleRef) return { kind: "preview" as const, data };
        const record: ActiveSaleRecord = { version: 1, saleRef: data.saleRef, idempotencyKey: key };
        // Written even if this view was replaced, so the sale is never orphaned.
        const stored = storeActiveSale(record);
        if (stored === "stored") return { kind: "stored" as const, data, record };
        let release: ReleaseResult | "unknown";
        try {
          release = await releaseOnServer(record);
        } catch {
          release = "unknown";
        }
        return { kind: "unsaved" as const, data, record, release, occupied: stored === "occupied" };
      });
      if (authEpoch !== authEpochRef.current) return;
      if (outcome.status !== "held") {
        setNotice(lockRefusalMessage[outcome.status]);
        return;
      }
      const result = outcome.value;
      if (result.kind === "occupied") {
        setNotice("Another sale is already open on this register. Nothing was sent.");
        return;
      }
      if (result.kind === "lost") {
        setPreview(null);
        setNotice(
          `${result.error}. The sale may already be stored. Review again without changes to recover the same sale; changing it leaves that hold to expire.`
        );
        return;
      }
      if (result.kind === "refused") {
        setPreview(null);
        setNotice(result.error);
        return;
      }
      if (result.kind === "preview") {
        setPreview(result.data);
        setNotice("Server total reviewed. Reader payment needs the linked backend, staff sign-in and a stored reader.");
        return;
      }
      const reviewed: PosSaleStatusResponse = {
        saleRef: result.record.saleRef,
        status: "draft",
        paymentState: "draft",
        currency: "usd",
        subtotalCents: result.data.draft.subtotalCents,
        feeCents: result.data.draft.feeCents,
        totalCents: result.data.draft.totalCents,
        visitDate: result.data.draft.visitDate,
        entryTime: result.data.draft.entryTime,
        party,
        lines: result.data.draft.lines,
        readerId: result.data.draft.readerId,
        readerRetryAllowed: false,
        // A just-stored draft has no delivery or entry yet.
        ticketIssued: false,
        admissionUsed: false
      };
      setPreview(null);
      if (result.kind === "stored") {
        setSaleStatus(reviewed);
        setNotice(
          !terminalAccepted
            ? "Sale stored. Reader payments are switched off on this register."
            : result.data.draft.readerId
              ? null
              : "Sale stored without a reader. Change the sale and choose an authorized reader to take payment."
        );
        return;
      }
      const why = result.occupied
        ? "Another sale is already saved on this browser, so this one was not saved and payment stays off here."
        : "This browser could not save the sale for recovery, so payment stays off here.";
      if (result.release === "released") {
        setIdempotencyKey(createIdempotencyKey());
        setNotice(`${why} The server released the review and its places.`);
        return;
      }
      // Without a confirmed release the sale stays locked in this tab.
      setUnsavedSale(result.record);
      setSaleStatus(reviewed);
      if (result.release === "refused") {
        setPending({ saleRef: result.record.saleRef, action: "release", phase: "unconfirmed" });
        setNotice(`${why} The server did not release it; use Refresh Status and keep this tab open.`);
      } else {
        setNotice(`${why} Its release was not confirmed; Clear Sale tries again. Keep this tab open.`);
      }
    } catch (error) {
      if (authEpoch !== authEpochRef.current) return;
      setPreview(null);
      setNotice(errorText(error, "Could not review this sale"));
    } finally {
      endAction(token);
    }
  }

  /**
   * A refused lock sends nothing. If another tab holds it, that tab may be
   * changing this sale, so the cached actions stay withdrawn until a
   * lock-held read; nothing is queued to run later.
   */
  function lockRefused(status: "busy" | "unavailable", saleRef?: string) {
    if (status === "busy" && saleRef) {
      pollVersionRef.current += 1;
      setPending({ saleRef, action: "contended", phase: "unconfirmed" });
      setNotice(null);
      return;
    }
    setNotice(lockRefusalMessage[status]);
  }

  /** Draft-only: an audited server release frees the places, then the cart unlocks. */
  async function releaseDraft(clearAfter: boolean) {
    if (actionRef.current || !activeSale || paymentState !== "draft") return;
    const token = beginAction("release");
    if (!token) return;
    setNotice(null);
    const authEpoch = authEpochRef.current;
    const sale = activeSale;
    const fromStorage = durable;
    try {
      const outcome = await withRegisterLock(async () => {
        if (fromStorage) {
          const slot = readActiveSaleSlot();
          if (slot.kind !== "sale" || !sameSale(slot.record, sale)) return { kind: "moved" as const };
        }
        const released = await releaseOnServer(sale);
        if (released === "refused") return { kind: "refused" as const };
        return { kind: "released" as const, cleared: fromStorage ? clearActiveSale(sale) : ("cleared" as const) };
      });
      if (authEpoch !== authEpochRef.current) return;
      if (outcome.status !== "held") {
        lockRefused(outcome.status, sale.saleRef);
        return;
      }
      const result = outcome.value;
      if (result.kind === "moved") {
        setNotice("The saved register sale changed in another tab, so nothing was released.");
        return;
      }
      if (result.kind === "refused") {
        pollVersionRef.current += 1;
        setPending({ saleRef: sale.saleRef, action: "release", phase: "checking" });
        setNotice("This sale already reached payment, so it stays locked. Use Refresh Status.");
        void loadStatus(sale.saleRef, authEpoch, { verify: true });
        return;
      }
      if (result.cleared === "failed") {
        pollVersionRef.current += 1;
        setPending({ saleRef: sale.saleRef, action: "release", phase: "checking" });
        setNotice("The places were released, but this browser could not clear its saved sale, so it stays locked. Use Refresh Status, then Start New Sale.");
        void loadStatus(sale.saleRef, authEpoch, { verify: true });
        return;
      }
      setUnsavedSale(null);
      setSaleStatus(null);
      setPending(null);
      if (result.cleared === "different_sale") {
        setNotice("The places were released. Another sale is now saved on this register and was left in place.");
      } else if (clearAfter || (cart.length === 0 && !hasAdmission)) {
        clearLocalSale();
        setNotice("Sale cleared and its places released.");
      } else {
        resetReview();
        setNotice("Sale reopened for changes and its places released.");
      }
    } catch (error) {
      if (authEpoch !== authEpochRef.current) return;
      // The release may or may not have landed; only a fresh read decides.
      pollVersionRef.current += 1;
      setPending({ saleRef: sale.saleRef, action: "release", phase: "unconfirmed" });
      setNotice(`${errorText(error, "Could not release this sale")}. The release was not confirmed, so the sale stays locked.`);
    } finally {
      endAction(token);
    }
  }

  /**
   * Sends one stored sale to the reader. The draft authority is replaced
   * before the first request, the sale is re-read under the lock before any
   * send, and authority comes back only from a lock-held status read.
   */
  async function sendToReader(kind: "pay" | "reader") {
    if (actionRef.current || !activeSale || !durable) return;
    if (kind === "pay" && paymentState !== "draft") return;
    if (kind === "reader" && (paymentState !== "awaiting_payment" || !currentStatus?.readerRetryAllowed)) return;
    if (!terminalAccepted) {
      setNotice("Reader payments are switched off on this register.");
      return;
    }
    if (!currentStatus?.readerId) {
      setNotice("This sale has no authorized reader stored.");
      return;
    }
    const token = beginAction(kind);
    if (!token) return;
    setNotice(null);
    const authEpoch = authEpochRef.current;
    const sale = activeSale;
    pollVersionRef.current += 1;
    setPending({ saleRef: sale.saleRef, action: "payment", phase: "sending" });
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({ saleRef: sale.saleRef, idempotencyKey: sale.idempotencyKey });
    const clearPending = () => setPending((value) => (value?.saleRef === sale.saleRef ? null : value));
    const awaitOutcome = () => {
      setPending({ saleRef: sale.saleRef, action: "payment", phase: "checking" });
      void loadStatus(sale.saleRef, authEpoch, { poll: true, verify: true });
    };
    try {
      const outcome = await withRegisterLock(async () => {
        const slot = readActiveSaleSlot();
        if (slot.kind !== "sale" || !sameSale(slot.record, sale)) return { kind: "moved" as const };
        // The cached status may predate another tab's write; act only on a
        // read made while this tab holds the lock.
        let fresh: PosSaleStatusResponse;
        try {
          fresh = await readStatus(sale.saleRef, false);
        } catch (error) {
          return { kind: "unread" as const, error: errorText(error, "Could not load sale status") };
        }
        const ready =
          kind === "pay" ? fresh.paymentState === "draft" : fresh.paymentState === "awaiting_payment" && fresh.readerRetryAllowed;
        if (!ready) return { kind: "changed" as const, fresh };
        try {
          if (kind === "pay") {
            // The server freezes the request and moves the sale to pending before
            // calling Stripe; a retry resumes the same PaymentIntent.
            const intentResponse = await staffSession.staffFetch("/api/payments/stripe-terminal", { method: "POST", headers, body });
            const intentData = (await intentResponse.json().catch(() => ({}))) as { error?: string };
            if (!intentResponse.ok) throw new Error(intentData.error ?? "Could not start the payment");
          }
          // The intent may already exist, but the previous staff session must
          // not continue its dependent send. Keep the sale for reconciliation.
          if (authEpoch !== authEpochRef.current) throw new Error("Staff session changed.");
          const processResponse = await staffSession.staffFetch("/api/payments/stripe-terminal/process", { method: "POST", headers, body });
          const processData = (await processResponse.json().catch(() => ({}))) as { error?: string; status?: string };
          if (!processResponse.ok) throw new Error(processData.error ?? "Could not send the payment to the reader");
          return { kind: processData.status === "failed" ? ("declined" as const) : ("sent" as const) };
        } catch (error) {
          return { kind: "failed" as const, error: errorText(error, "Could not take the payment") };
        }
      });
      if (authEpoch !== authEpochRef.current) return;
      if (outcome.status !== "held") {
        if (outcome.status === "unavailable") clearPending();
        lockRefused(outcome.status, sale.saleRef);
        return;
      }
      const result = outcome.value;
      switch (result.kind) {
        case "moved":
          clearPending();
          setNotice("The saved register sale changed in another tab, so nothing was sent.");
          return;
        case "unread":
          setPending({ saleRef: sale.saleRef, action: "stale", phase: "unconfirmed" });
          setNotice(`${result.error}. The sale stays locked.`);
          return;
        case "changed":
          setSaleStatus(result.fresh);
          clearPending();
          setNotice("This sale changed since this screen last read it, so nothing was sent. Check the current status.");
          return;
        case "failed":
          setNotice(`${result.error}. The payment may have started; do not charge again.`);
          awaitOutcome();
          return;
        case "declined":
          setNotice("The reader did not take the card. Send the same payment again when the status allows it.");
          awaitOutcome();
          return;
        case "sent":
          setNotice("Sent to the reader. Wait for Stripe to confirm; the reader screen alone is not proof of payment.");
          awaitOutcome();
          return;
      }
    } catch (error) {
      if (authEpoch !== authEpochRef.current) return;
      setPending({ saleRef: sale.saleRef, action: "payment", phase: "unconfirmed" });
      setNotice(`${errorText(error, "Could not take the payment")}. The payment may have started; do not charge again.`);
    } finally {
      endAction(token);
    }
  }

  async function refreshStatus() {
    if (!activeSale) return;
    const token = beginAction("refresh");
    if (!token) return;
    setNotice(null);
    const authEpoch = authEpochRef.current;
    try {
      // Lock-held so it can restore actions; refused while another tab writes.
      await loadStatus(activeSale.saleRef, authEpoch, { refresh: true, verify: true });
    } finally {
      endAction(token);
    }
  }

  async function startNewSale() {
    if (actionRef.current || !activeSale || !finished) return;
    const token = beginAction("finish");
    if (!token) return;
    setNotice(null);
    const authEpoch = authEpochRef.current;
    const sale = activeSale;
    const fromStorage = durable;
    try {
      const outcome = await withRegisterLock(async () => (fromStorage ? clearActiveSale(sale) : "cleared"));
      if (authEpoch !== authEpochRef.current) return;
      if (outcome.status !== "held") {
        lockRefused(outcome.status, sale.saleRef);
        return;
      }
      if (outcome.value === "failed") {
        setNotice("This browser could not clear the finished sale, so the register stays on it. Check browser storage, then try again.");
        return;
      }
      setUnsavedSale(null);
      setSaleStatus(null);
      setPending(null);
      if (outcome.value === "different_sale") {
        setNotice("Another sale is now saved on this register and was left in place.");
        return;
      }
      clearLocalSale();
    } finally {
      endAction(token);
    }
  }

  function clearSale() {
    if (actionRef.current) return;
    if (locked) {
      void releaseDraft(true);
      return;
    }
    clearLocalSale();
    setNotice(null);
  }

  async function endStaffSession() {
    authEpochRef.current += 1;
    pollVersionRef.current += 1;
    // An in-flight request keeps the register lock until it settles; this
    // view stops listening to it. The stored sale identity stays so the next
    // signed-in cashier returns to it.
    actionRef.current = null;
    setReaderOptions([]);
    setSelectedReaderKey("");
    setReaderMessage(null);
    setAuthorizedStaff(null);
    setPreview(null);
    setSaleStatus(null);
    setPending(null);
    setBusy(null);
    setNotice(null);
    if (!locked) clearLocalSale();
    await staffSession.signOut();
  }

  const shownLines = currentStatus?.lines ?? preview?.draft.lines;
  const shownTotal = currentStatus?.totalCents ?? preview?.draft.totalCents;
  const shownParty = currentStatus ? currentStatus.party : hasAdmission ? { ...counts, total: partySize } : undefined;
  const shownVisit = currentStatus ? visitLabel(currentStatus.visitDate, currentStatus.entryTime) : visitLabel(validVisitDate ?? undefined, entryTime || undefined);
  const statusText =
    storedSlot.kind === "unreadable"
      ? "This browser cannot read its saved register sale, so a sale may still be open. New sales and payments stay off here; check recent POS sales with a manager."
      : storedSlot.kind === "corrupt"
        ? "The saved register sale on this browser is damaged, so a sale may still be open. New sales and payments stay off here; check recent POS sales with a manager."
        : currentPending
          ? pendingMessage(currentPending)
          : currentStatus
            ? !durable && currentStatus.paymentState === "draft"
              ? "Payment stays off on this browser because the sale could not be saved for recovery. Clear Sale releases its places."
              : saleStatusMessage(currentStatus, today)
            : locked
              ? signedIn
                ? "Loading the stored sale…"
                : "A sale is open on this register. Sign in to load it."
              : null;
  const announcement = [statusText, notice].filter(Boolean).join(" ");
  const attention =
    paymentState === "paid_needs_attention" || paymentState === "unknown" || storedSlot.kind === "unreadable" || storedSlot.kind === "corrupt";
  const disabledForSession = !signedIn || busy !== null;

  function navigateCatalogTabs(event: KeyboardEvent<HTMLButtonElement>, tab: Tab) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = catalogTabs.indexOf(tab);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % catalogTabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index + catalogTabs.length - 1) % catalogTabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = catalogTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = catalogTabs[nextIndex];
    setActiveTab(nextTab);
    catalogTabRefs.current[nextTab]?.focus();
  }

  return (
    <section className="posNextShell" aria-label="POS sale">
      <div className="posNextCatalog">
        <div className="posNextToolbar" role="tablist" aria-label="POS catalog">
          {catalogTabs.map((tab) => (
            <button
              key={tab}
              id={`${catalogId}-${tab}-tab`}
              ref={(node) => { catalogTabRefs.current[tab] = node; }}
              className={activeTab === tab ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`${catalogId}-${tab}-panel`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onFocus={() => setActiveTab(tab)}
              onKeyDown={(event) => navigateCatalogTabs(event, tab)}
            >
              {tab === "admission" ? "Admission" : tab === "cafe" ? "Cafe" : "Custom"}
            </button>
          ))}
        </div>

          <div
            id={`${catalogId}-admission-panel`}
            className="posNextAdmission"
            role="tabpanel"
            aria-labelledby={`${catalogId}-admission-tab`}
            tabIndex={0}
            hidden={activeTab !== "admission"}
            style={activeTab === "admission" ? undefined : { display: "none" }}
          >
            <fieldset className="posNextVisit" disabled={editLocked}>
              <legend>Visit</legend>
              <label>
                <span>Date</span>
                <input
                  type="date"
                  min={today || undefined}
                  disabled={editLocked}
                  value={visitDate}
                  onChange={(event) => {
                    if (!canEdit()) return;
                    setVisitDate(event.target.value);
                    setEntryTime("");
                    resetReview();
                  }}
                />
              </label>
              <label>
                <span>Entry time</span>
                <select
                  value={entryTime}
                  disabled={editLocked}
                  onChange={(event) => {
                    if (!canEdit()) return;
                    setEntryTime(event.target.value);
                    resetReview();
                  }}
                >
                  <option value="">Choose a time</option>
                  {checkoutEntryTimes.map((slot) => {
                    const known = availability?.slots.find((candidate) => candidate.entryTime === slot.value);
                    const note = !known
                      ? ""
                      : known.status === "available"
                        ? ` — ${known.remaining} left`
                        : known.status === "full"
                          ? " — full"
                          : known.status === "past"
                            ? " — past"
                            : known.status === "private_event"
                              ? " — private event"
                              : known.status === "unverified"
                                ? " — unconfirmed"
                                : " — closed";
                    return (
                      <option key={slot.value} value={slot.value} disabled={Boolean(known && known.status !== "available")}>
                        {`${slot.label}${note}`}
                      </option>
                    );
                  })}
                </select>
              </label>
            </fieldset>

            <div className="posNextAges" role="group" aria-label="Party by age">
              {([
                ["adults", admissionAgeCategories.adult],
                ["youths", admissionAgeCategories.youth],
                ["children", admissionAgeCategories.child]
              ] as const).map(([field, category]) => (
                <div className="posNextAgeRow" key={field}>
                  <span>
                    {category.label} · {category.priceCents ? money(category.priceCents) : "Free"}
                  </span>
                  <div className="posNextStepper">
                    <button
                      type="button"
                      disabled={editLocked || counts[field] === 0}
                      onClick={() => setCount(field, -1)}
                      aria-label={`One fewer ${category.label}`}
                    >
                      -
                    </button>
                    <output aria-label={`${category.label} count`}>{counts[field]}</output>
                    <button
                      type="button"
                      disabled={editLocked || partySize >= admissionMaxPartySize}
                      onClick={() => setCount(field, 1)}
                      aria-label={`One more ${category.label}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <p className="posNextAvailability" role="status" aria-live="polite">
              {!hasAdmission
                ? "Add guests to check room. Every age counts toward the 30 people inside at once."
                : counts.adults < 1
                  ? "Admission needs at least one adult 18+."
                  : !validVisitDate
                    ? "Choose a valid visit date."
                    : availabilityFailed
                      ? "Live room could not be checked. Review will confirm it."
                      : !availability
                        ? "Checking room…"
                        : availability.dayStatus === "private_event"
                          ? "That date is reserved for a private event."
                          : !entryTime
                            ? `${partySize} ${partySize === 1 ? "person" : "people"} · choose an entry time.`
                            : selectedSlot?.status === "available"
                              ? `${selectedSlot.remaining} of ${availability.capacity} places open for ${partySize} at ${entryTimeLabels.get(entryTime)}.`
                              : "That entry time cannot take this party. Choose another."}
            </p>
          </div>
          <div
            id={`${catalogId}-cafe-panel`}
            className="posNextGrid"
            role="tabpanel"
            aria-labelledby={`${catalogId}-cafe-tab`}
            tabIndex={0}
            hidden={activeTab !== "cafe"}
            style={activeTab === "cafe" ? undefined : { display: "none" }}
          >
            {cafeItems.map((item) => (
              <button className="posNextItem" key={item.key} type="button" disabled={editLocked} onClick={() => addCafeLine(item)}>
                <span>{item.name}</span>
                <strong>{money(item.priceCents)}</strong>
              </button>
            ))}
          </div>
          <fieldset
            id={`${catalogId}-custom-panel`}
            className="posNextCustom"
            role="tabpanel"
            aria-labelledby={`${catalogId}-custom-tab`}
            tabIndex={0}
            hidden={activeTab !== "custom"}
            style={activeTab === "custom" ? undefined : { display: "none" }}
            disabled={editLocked}
          >
            <label>
              <span>Name</span>
              <input
                value={customName}
                onChange={(event) => {
                  if (canEdit()) setCustomName(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Amount</span>
              <input
                inputMode="decimal"
                placeholder="12.00"
                value={customAmount}
                onChange={(event) => {
                  if (canEdit()) setCustomAmount(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Reason</span>
              <input
                value={customReason}
                onChange={(event) => {
                  if (canEdit()) setCustomReason(event.target.value);
                }}
              />
            </label>
            <button className="primaryAction" type="button" onClick={addCustomLine}>
              Add Custom
            </button>
          </fieldset>
      </div>

      <aside className="posNextCart" aria-label="POS cart">
        <div className="posNextCartHeader">
          <h2>{currentStatus ? `Sale ${currentStatus.saleRef}` : "Current Sale"}</h2>
          <ShieldCheck size={24} />
        </div>

        <div className="posNextLines">
          {shownParty && shownParty.total > 0 ? (
            <div className="posNextLine posNextAdmissionLine">
              <div>
                <strong>Admission · {shownParty.total} {shownParty.total === 1 ? "person" : "people"}</strong>
                <span>{partyDescription({ adults: shownParty.adults, youths: shownParty.youths, children: shownParty.children })}</span>
                {shownVisit ? <span>{shownVisit}</span> : <span>Choose the visit date and time</span>}
              </div>
              {!currentStatus ? <strong>{money(admissionCents)}</strong> : null}
            </div>
          ) : null}
          {currentStatus || preview ? (
            (shownLines ?? [])
              .filter((line) => line.kind !== "ticket")
              .map((line, index) => (
                <div className="posNextLine" key={`${line.kind}:${line.productKey ?? line.name}:${index}`}>
                  <div>
                    <strong>{line.name}</strong>
                    <span>× {line.quantity}</span>
                  </div>
                  <strong>{money(line.lineTotalCents)}</strong>
                </div>
              ))
          ) : cart.length === 0 && !hasAdmission ? (
            <p className="posNextEmpty">No items</p>
          ) : (
            cart.map((line) => (
              <div className="posNextLine" key={line.id}>
                <div>
                  <strong>{line.name}</strong>
                  <span>{line.kind === "custom" ? money(line.amountCents) : "Cafe"}</span>
                </div>
                <div className="posNextStepper">
                  <button type="button" disabled={editLocked} onClick={() => updateQuantity(line.id, -1)} aria-label={`Remove one ${line.name}`}>
                    -
                  </button>
                  <output aria-label={`${line.name} quantity`}>{line.quantity}</output>
                  <button type="button" disabled={editLocked} onClick={() => updateQuantity(line.id, 1)} aria-label={`Add one ${line.name}`}>
                    +
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <label className="posNextEmail">
          <span>Email for ticket</span>
          <input
            inputMode="email"
            placeholder="guest@example.com"
            type="email"
            disabled={editLocked}
            value={customerEmail}
            onChange={(event) => {
              if (!canEdit()) return;
              setCustomerEmail(event.target.value);
              resetReview();
            }}
          />
        </label>

        <div className="posNextTerminalSetup" aria-label="Terminal setup">
          <div className="posNextStaffSession">
            {staffSession.status === "signed-in" || staffSession.status === "signing-out" ? (
              <>
                <span>{authorizedStaff ? "Staff authorized" : "Identity verified"}</span>
                <strong>{authorizedStaff?.emailLower ?? staffSession.email ?? "Verify staff access"}</strong>
                <button
                  className="secondaryAction"
                  type="button"
                  disabled={staffSession.status === "signing-out"}
                  onClick={() => void endStaffSession()}
                >
                  {staffSession.status === "signing-out" ? "Signing out" : "Sign out"}
                </button>
              </>
            ) : staffSession.status === "unconfigured" ? (
              <>
                <span>Setup required</span>
                <strong>Clerk and Convex are not linked yet.</strong>
              </>
            ) : staffSession.status === "loading" ? (
              <span>Checking staff session</span>
            ) : (
              <>
                <span>Signed out</span>
                <Link
                  className="secondaryAction"
                  href={`/staff-sign-in?returnTo=${encodeURIComponent(pathname === "/pos-next" ? "/pos-next" : "/pos")}`}
                  prefetch={false}
                >
                  Staff sign in
                </Link>
              </>
            )}
          </div>
          <div className="posNextTerminalPicker">
            <label>
              <span>Authorized Reader</span>
              <select
                value={selectedReaderKey}
                disabled={readerOptions.length === 0 || editLocked}
                onChange={(event) => {
                  if (!canEdit()) return;
                  setSelectedReaderKey(event.target.value);
                  resetReview();
                }}
              >
                <option value="">No reader selected</option>
                {readerOptions.map((option) => (
                  <option key={readerOptionKey(option)} value={readerOptionKey(option)}>
                    {[option.label, option.readerId, option.terminalLocationId].filter(Boolean).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondaryAction"
              type="button"
              disabled={!signedIn || editLocked}
              onClick={loadTerminalReaders}
            >
              {busy === "readers" ? "Loading" : "Load Readers"}
            </button>
          </div>
          {readerMessage ? <p className="posNextTerminalNote">{readerMessage}</p> : null}
        </div>

        <div className="posNextTotals">
          <div>
            <span>{shownTotal !== undefined ? "Total" : "Estimated total"}</span>
            <strong>{money(shownTotal ?? previewCents)}</strong>
          </div>
          {currentStatus?.readerId ? (
            <div>
              <span>Reader</span>
              <strong>{currentStatus.readerId}</strong>
            </div>
          ) : null}
        </div>

        <PosSaleOutcome
          status={currentPending ? undefined : currentStatus ?? undefined}
          today={today}
          message={announcement}
          attention={attention}
        />

        <div className="posNextActions">
          {!locked ? (
            <button className="primaryAction" type="button" disabled={disabledForSession || (cart.length === 0 && !hasAdmission)} onClick={reviewSale}>
              {busy === "review" ? "Reviewing" : "Review Sale"}
              <ArrowRight size={18} />
            </button>
          ) : null}
          {paymentState === "draft" && durable ? (
            <button
              className="primaryAction"
              type="button"
              disabled={disabledForSession || !terminalAccepted || !currentStatus?.readerId}
              onClick={() => void sendToReader("pay")}
            >
              {busy === "pay" ? "Sending to Reader" : "Send to Reader"}
              <ArrowRight size={18} />
            </button>
          ) : null}
          {paymentState === "awaiting_payment" && durable ? (
            <button
              className="primaryAction"
              type="button"
              disabled={disabledForSession || !currentStatus?.readerRetryAllowed}
              onClick={() => void sendToReader("reader")}
            >
              {busy === "reader" ? "Sending" : "Send Same Payment Again"}
            </button>
          ) : null}
          {activeSale && paymentState !== "draft" ? (
            <button className="secondaryAction" type="button" disabled={disabledForSession} onClick={refreshStatus}>
              {busy === "refresh" ? "Checking Stripe" : "Refresh Status"}
            </button>
          ) : null}
          {paymentState === "draft" ? (
            <button className="secondaryAction" type="button" disabled={disabledForSession} onClick={() => void releaseDraft(false)}>
              {busy === "release" ? "Releasing" : "Change Sale"}
            </button>
          ) : null}
          {finished ? (
            <button className="primaryAction" type="button" disabled={busy !== null} onClick={() => void startNewSale()}>
              Start New Sale
            </button>
          ) : null}
          {!locked || paymentState === "draft" ? (
            <button
              className="checkoutTextButton"
              type="button"
              disabled={busy !== null || (!locked && cart.length === 0 && !hasAdmission)}
              onClick={clearSale}
            >
              Clear Sale
            </button>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
