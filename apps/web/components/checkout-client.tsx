"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addVisitDays,
  admissionAgeCategories,
  admissionMaxPartySize,
  admissionMinAdults,
  checkoutBookingWindowDays,
  checkoutEntryTimes,
  currentLiabilityWaiverVersion,
  currentRefundAndVisitPolicyLabel,
  currentTermsAgeRepresentationText,
  currentTermsDocumentLabel,
  currentTermsVersion,
  formatVisitDateLabel,
  parseVisitDate,
  venueToday,
  type AdmissionPartyField,
  type TicketPackageKey
} from "@skyla/payments";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";
import {
  formatOperatingDay,
  operatingWeekdayForDate,
  type OperatingHours
} from "@/lib/operating-hours";
import { parseVisitAvailability, type VisitAvailability } from "@/lib/visit-availability";

type PackageOption = {
  key: TicketPackageKey;
  name: string;
  priceCents: number;
};

type AddonOption = {
  key: string;
  name: string;
  priceCents: number;
};

type DraftLine = {
  kind: string;
  productKey?: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  metadata?: Record<string, string | number | boolean>;
};

type DraftResponse = {
  draft: {
    status: "draft";
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
    orderRef?: string;
    lines: DraftLine[];
  };
  orderRef?: string;
  persisted: boolean;
  persistenceReason?: "convex_unconfigured" | "idempotencyKey_required";
};

type CheckoutClientProps = {
  packages: PackageOption[];
  addons?: AddonOption[];
  stripeStatus?: "success" | "cancel";
  returnedCheckoutSessionId?: string;
  operatingHours?: OperatingHours | null;
  initialPackageKey?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const visitorCounters = [
  { field: "adults", category: admissionAgeCategories.adult, fewer: "Fewer adults", more: "More adults" },
  { field: "children", category: admissionAgeCategories.youth, fewer: "Fewer youths", more: "More youths" },
  { field: "freeChildren", category: admissionAgeCategories.child, fewer: "Fewer children", more: "More children" }
] as const;
const ticketCodePattern = /^tkt_[a-f0-9]{32}$/;
const entryTimeLabels = new Map<string, string>(checkoutEntryTimes.map((time) => [time.value, time.label]));
// Party-count clicks settle before one live read is sent.
const availabilityDebounceMs = 150;
// One started card payment per browser. Only opaque order identity is kept;
// no name, email or ticket code.
const paymentIntentStorageKey = "skyla.checkout.paymentIntent.v1";
const storedIdempotencyKeyPattern = /^[A-Za-z0-9_-]{12,96}$/;
const supportEmail = "reservations@skydeckla.com";

type PaymentIntentRecord = {
  version: 1;
  orderRef: string;
  idempotencyKey: string;
};

type IntentStatus = "none" | "checking" | "awaiting_payment" | "pending" | "needs_attention" | "unknown";

type AttemptStatusResponse = {
  orderRef?: string;
  status?: "not_started" | "awaiting_payment" | "pending" | "confirmed" | "needs_attention" | "failed" | "canceled";
  bookingRef?: string;
  ticketCode?: string;
  expiresAt?: number;
};

const paymentIntentChangeEvent = "skyla:checkout-payment-intent";

function readStoredPaymentIntentRaw() {
  try {
    return window.localStorage.getItem(paymentIntentStorageKey);
  } catch {
    // Unavailable storage means there is nothing to recover.
    return null;
  }
}

function parseStoredPaymentIntent(raw: string | null): PaymentIntentRecord | null {
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<PaymentIntentRecord> | null;
    if (
      parsed?.version === 1 &&
      typeof parsed.orderRef === "string" &&
      parsed.orderRef.length > 0 &&
      parsed.orderRef.length <= 80 &&
      typeof parsed.idempotencyKey === "string" &&
      storedIdempotencyKeyPattern.test(parsed.idempotencyKey)
    ) {
      return { version: 1, orderRef: parsed.orderRef, idempotencyKey: parsed.idempotencyKey };
    }
  } catch {
    // Corrupt storage means there is nothing to recover.
  }
  return null;
}

function subscribeToStoredPaymentIntent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(paymentIntentChangeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(paymentIntentChangeEvent, onChange);
  };
}

function writeStoredPaymentIntent(record: PaymentIntentRecord | null) {
  try {
    const raw = record ? JSON.stringify(record) : null;
    if (raw) window.localStorage.setItem(paymentIntentStorageKey, raw);
    else window.localStorage.removeItem(paymentIntentStorageKey);
    if (window.localStorage.getItem(paymentIntentStorageKey) !== raw) return false;
  } catch {
    // A payment must not start if its private recovery identity cannot survive
    // a reload. One Session per order alone cannot protect a new order.
    return false;
  }
  window.dispatchEvent(new Event(paymentIntentChangeEvent));
  return true;
}

type IntentCheckResult =
  | { kind: "clear" | "ended" }
  | { kind: "confirmed"; ticketCode: string | null }
  | { kind: "status"; status: IntentStatus; expiresAt?: number };

async function fetchPaymentIntentStatus(record: PaymentIntentRecord): Promise<IntentCheckResult> {
  try {
    const response = await fetch("/api/payments/stripe-checkout/status", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderRef: record.orderRef, idempotencyKey: record.idempotencyKey })
    });
    const data = (await response.json().catch(() => ({}))) as AttemptStatusResponse;
    if (!response.ok || !data.status || data.orderRef !== record.orderRef) return { kind: "status", status: "unknown" };
    switch (data.status) {
      case "not_started": {
        // A delayed original request may still be about to begin payment.
        // Atomically close this draft before allowing another order. If the
        // payment won the race, the release fails and this intent stays locked.
        const release = await fetch("/api/order-drafts/checkout/release", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderRef: record.orderRef, idempotencyKey: record.idempotencyKey })
        });
        const result = await release.json().catch(() => ({})) as { released?: boolean };
        return release.ok && result.released === true ? { kind: "ended" } : { kind: "status", status: "pending" };
      }
      case "failed":
      case "canceled":
        return { kind: "ended" };
      case "confirmed":
        return { kind: "confirmed", ticketCode: normalizeVerifiedTicketCode(data.ticketCode) };
      case "awaiting_payment":
        return {
          kind: "status",
          status: "awaiting_payment",
          ...(typeof data.expiresAt === "number" ? { expiresAt: data.expiresAt } : {})
        };
      default:
        return { kind: "status", status: data.status };
    }
  } catch {
    return { kind: "status", status: "unknown" };
  }
}

function formatClockTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

type AvailabilityState = {
  key: string;
  status: "ready" | "error";
  data?: VisitAvailability;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(cents / 100);
}

function todayIso() {
  return venueToday(Date.now());
}

function clearStripeReturnIdentity() {
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.delete("stripe");
  returnUrl.searchParams.delete("session_id");
  returnUrl.searchParams.delete("order");
  window.history.replaceState(window.history.state, "", returnUrl);
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `checkout_${crypto.randomUUID()}`;
  }
  return `checkout_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function optionalResponseString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVerifiedTicketCode(value: unknown) {
  const ticketCode = optionalResponseString(value)?.toLowerCase();
  return ticketCode && ticketCodePattern.test(ticketCode) ? ticketCode : null;
}

export function CheckoutClient({
  packages,
  stripeStatus,
  returnedCheckoutSessionId,
  operatingHours = null,
  initialPackageKey
}: CheckoutClientProps) {
  const initialVisitDate = todayIso();
  const [packageKey, setPackageKey] = useState<TicketPackageKey>(
    () =>
      packages.find((item) => item.key === initialPackageKey)?.key ?? packages[0]?.key ?? "general"
  );
  const [party, setParty] = useState<Record<AdmissionPartyField, number>>({
    adults: 2,
    children: 0,
    freeChildren: 0
  });
  const [partyLimitNotice, setPartyLimitNotice] = useState<string | null>(null);
  const [visitDate, setVisitDate] = useState(initialVisitDate);
  // The guest's explicit time choice. Until they pick one, the earliest
  // available time for the selected date is preselected.
  const [chosenEntryTime, setChosenEntryTime] = useState("");
  const [autoEntryTime, setAutoEntryTime] = useState(true);
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState | null>(null);
  const [availabilityReload, setAvailabilityReload] = useState(0);
  const [customerEmail, setCustomerEmail] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  // Once a review is sent, the key may own a stored draft; any later change
  // to the order uses a fresh key instead of colliding with that draft.
  const [idempotencyKeyUsed, setIdempotencyKeyUsed] = useState(false);
  const reviewSequence = useRef(0);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [liabilityWaiverAccepted, setLiabilityWaiverAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [returnStatus, setReturnStatus] = useState<
    "checking" | "pending" | "confirmed" | "failed" | "canceled" | "needs_attention" | "unavailable"
  >(stripeStatus === "success" ? "checking" : "pending");
  const [verifiedOrderRef, setVerifiedOrderRef] = useState<string | null>(null);
  const [verifiedBookingRef, setVerifiedBookingRef] = useState<string | null>(null);
  const [verifiedTicketCode, setVerifiedTicketCode] = useState<string | null>(null);
  // A card payment this browser started and has not seen settle, read from
  // storage so every tab of this browser sees it. While it is unresolved, no
  // second payment can be started.
  const storedIntentRaw = useSyncExternalStore(subscribeToStoredPaymentIntent, readStoredPaymentIntentRaw, () => null);
  const paymentIntent = useMemo(() => parseStoredPaymentIntent(storedIntentRaw), [storedIntentRaw]);
  const [intentCheck, setIntentCheck] = useState<{ orderRef: string; status: IntentStatus; expiresAt?: number } | null>(null);
  const [confirmedIntent, setConfirmedIntent] = useState<{ orderRef: string; ticketCode: string | null } | null>(null);
  const paymentInFlight = useRef(false);
  const intentCheckSequence = useRef(0);
  const returnedFromStripeSuccess = stripeStatus === "success" && Boolean(returnedCheckoutSessionId);
  const currentIntentCheck = paymentIntent && intentCheck?.orderRef === paymentIntent.orderRef ? intentCheck : null;
  // A Stripe success return is confirmed by its own Session poll below.
  const intentStatus: IntentStatus = !paymentIntent
    ? "none"
    : currentIntentCheck?.status ?? (returnedFromStripeSuccess ? "pending" : "checking");
  const intentExpiresAt = currentIntentCheck?.expiresAt ?? null;

  const selectedPackage = packages.find((item) => item.key === packageKey) ?? packages[0];
  const partySize = party.adults + party.children + party.freeChildren;
  const partyFull = partySize >= admissionMaxPartySize;
  const counterPriceCents: Record<AdmissionPartyField, number> = {
    adults: selectedPackage?.priceCents ?? admissionAgeCategories.adult.priceCents,
    children: admissionAgeCategories.youth.priceCents,
    freeChildren: admissionAgeCategories.child.priceCents
  };
  const estimatedTotalCents = visitorCounters.reduce(
    (sum, counter) => sum + party[counter.field] * counterPriceCents[counter.field],
    0
  );
  const normalizedEmail = customerEmail.trim().toLowerCase();
  const selectedWeekday = operatingWeekdayForDate(visitDate);
  const validVisitDate = parseVisitDate(visitDate);

  // Only a response for exactly this date, party, and reload is used, so a
  // slower response for an earlier selection can never drive the form.
  const availabilityKey = `${visitDate}|${partySize}|${availabilityReload}`;
  const currentAvailability = availabilityState?.key === availabilityKey ? availabilityState : null;
  const availabilityPhase = !validVisitDate ? "invalid" : currentAvailability?.status ?? "loading";
  const availability = currentAvailability?.status === "ready" ? currentAvailability.data ?? null : null;
  const slotByTime = new Map(availability?.slots.map((slot) => [slot.entryTime, slot]) ?? []);
  const firstAvailableEntryTime = availability?.slots.find((slot) => slot.status === "available")?.entryTime ?? "";
  const chosenSlotAvailable = slotByTime.get(chosenEntryTime)?.status === "available";
  const entryTime = !availability
    ? ""
    : chosenSlotAvailable
      ? chosenEntryTime
      : autoEntryTime
        ? firstAvailableEntryTime
        : "";
  const selectedSlot = entryTime ? slotByTime.get(entryTime) : undefined;
  const chosenEntryTimeLost = Boolean(availability && chosenEntryTime && !autoEntryTime && !chosenSlotAvailable);

  const canReview =
    !!selectedPackage &&
    party.adults >= admissionMinAdults &&
    partySize <= admissionMaxPartySize &&
    selectedSlot?.status === "available" &&
    selectedSlot.remaining >= partySize &&
    emailPattern.test(normalizedEmail);
  const orderPersisted = Boolean(draft?.persisted && draft.orderRef);
  const legalReady = termsAccepted && liabilityWaiverAccepted;
  const returnUnresolved = stripeStatus === "success" &&
    returnStatus !== "confirmed" && returnStatus !== "failed" && returnStatus !== "canceled";
  const paymentLocked = intentStatus !== "none" || returnUnresolved;
  const canPay = orderPersisted && legalReady && !isPaying && !paymentLocked;

  function clearPaymentIntent(expected?: PaymentIntentRecord) {
    const current = parseStoredPaymentIntent(readStoredPaymentIntentRaw());
    if (expected && (current?.orderRef !== expected.orderRef || current.idempotencyKey !== expected.idempotencyKey)) return;
    if (!writeStoredPaymentIntent(null)) return;
    setIntentCheck(null);
  }

  /** Reads the stored attempt for this browser's order; never trusts the browser's amount. */
  async function checkPaymentIntent(record: PaymentIntentRecord) {
    const sequence = ++intentCheckSequence.current;
    const result = await fetchPaymentIntentStatus(record);
    if (sequence === intentCheckSequence.current) applyIntentCheckResult(record, result);
  }

  function applyIntentCheckResult(record: PaymentIntentRecord, result: IntentCheckResult) {
    switch (result.kind) {
      case "clear":
        clearPaymentIntent(record);
        return;
      case "ended":
        clearPaymentIntent(record);
        // The atomically abandoned draft cannot be paid again with its old key.
        if (draft?.orderRef === record.orderRef) startNewOrder();
        setMessage(`The card payment for order ${record.orderRef} ended without payment. You can review a new order.`);
        return;
      case "confirmed":
        clearPaymentIntent(record);
        setConfirmedIntent({ orderRef: record.orderRef, ticketCode: result.ticketCode });
        return;
      case "status":
        setIntentCheck({ orderRef: record.orderRef, status: result.status, expiresAt: result.expiresAt });
    }
  }

  function recheckPaymentIntent(record: PaymentIntentRecord) {
    setIntentCheck({ orderRef: record.orderRef, status: "checking" });
    void checkPaymentIntent(record);
  }

  // A payment found in storage (after a reload, a Stripe return or another
  // tab) is checked once against the server; this tab's own start is not.
  const intentAlreadyKnown = useEffectEvent((record: PaymentIntentRecord) => intentCheck?.orderRef === record.orderRef);
  const onStoredIntentChecked = useEffectEvent((record: PaymentIntentRecord, result: IntentCheckResult) =>
    applyIntentCheckResult(record, result)
  );
  useEffect(() => {
    if (!paymentIntent || returnedFromStripeSuccess || intentAlreadyKnown(paymentIntent)) return;
    const sequence = ++intentCheckSequence.current;
    let disposed = false;
    void fetchPaymentIntentStatus(paymentIntent).then((result) => {
      if (!disposed && sequence === intentCheckSequence.current) onStoredIntentChecked(paymentIntent, result);
    });
    return () => {
      disposed = true;
    };
  }, [paymentIntent, returnedFromStripeSuccess]);

  useEffect(() => {
    if (!validVisitDate) return;
    const key = `${validVisitDate}|${partySize}|${availabilityReload}`;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ date: validVisitDate, party: String(partySize) });
        const response = await fetch(`/api/availability?${params}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const parsed = response.ok ? parseVisitAvailability(await response.json()) : null;
        if (controller.signal.aborted) return;
        setAvailabilityState(
          parsed && parsed.visitDate === validVisitDate && parsed.partySize === partySize
            ? { key, status: "ready", data: parsed }
            : { key, status: "error" }
        );
      } catch {
        if (!controller.signal.aborted) setAvailabilityState({ key, status: "error" });
      }
    }, availabilityDebounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [validVisitDate, partySize, availabilityReload]);

  useEffect(() => {
    if (stripeStatus !== "success" || !returnedCheckoutSessionId) {
      return;
    }
    const checkoutSessionId = returnedCheckoutSessionId;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    function scheduleNext(callback: () => void, delay: number) {
      timer = setTimeout(callback, delay);
    }

    async function checkStatus() {
      attempts += 1;
      try {
        const response = await fetch("/api/payments/stripe-checkout/status", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ checkoutSessionId })
        });
        const data = (await response.json()) as {
          orderRef?: string;
          status?: "pending" | "confirmed" | "failed" | "canceled" | "needs_attention";
          bookingRef?: string;
          ticketCode?: string;
        };
        if (!response.ok || !data.status || !data.orderRef) {
          if (response.status === 400 || response.status === 404) {
            if (!disposed) setReturnStatus("unavailable");
            return;
          }
          throw new Error("status unavailable");
        }
        if (disposed) return;
        setVerifiedOrderRef(data.orderRef);
        setVerifiedBookingRef(data.status === "confirmed" ? optionalResponseString(data.bookingRef) : null);
        setVerifiedTicketCode(data.status === "confirmed" ? normalizeVerifiedTicketCode(data.ticketCode) : null);
        setReturnStatus(data.status);
        if (data.status === "pending") {
          if (attempts < 10) {
            scheduleNext(checkStatus, 1500);
          } else {
            setReturnStatus("unavailable");
          }
        } else {
          clearStripeReturnIdentity();
          // A settled outcome ends this browser's payment intent; a payment
          // that needs staff help keeps the page from starting another one.
          if (data.status === "needs_attention") {
            setIntentCheck({ orderRef: data.orderRef, status: "needs_attention" });
          } else if (parseStoredPaymentIntent(readStoredPaymentIntentRaw())?.orderRef === data.orderRef) {
            writeStoredPaymentIntent(null);
          }
        }
      } catch {
        if (disposed) return;
        if (attempts < 10) {
          scheduleNext(checkStatus, Math.min(1000 * 2 ** (attempts - 1), 4000));
        } else {
          setReturnStatus("unavailable");
        }
      }
    }

    void checkStatus();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [returnedCheckoutSessionId, stripeStatus]);

  function returnNotice() {
    if (stripeStatus === "cancel") return "Payment was not completed.";
    if (!returnedCheckoutSessionId) {
      return "Returned from Stripe, but the confirmation identity is incomplete. Please contact support before trying another payment.";
    }
    if (returnStatus === "confirmed") {
      return `Payment confirmed. Booking ${verifiedBookingRef ?? verifiedOrderRef}.${verifiedTicketCode ? " Your ticket is ready." : " Keep this reference for admission."}`;
    }
    if (returnStatus === "needs_attention") {
      return `Your payment for order ${verifiedOrderRef} reached us, but the booking needs help from our team before a ticket can be issued. Please don't pay again; email ${supportEmail} with this order reference.`;
    }
    if (returnStatus === "failed") return "Stripe reported that the payment failed. No booking was confirmed.";
    if (returnStatus === "canceled") return "The payment expired or was canceled. No booking was confirmed.";
    if (returnStatus === "unavailable") {
      return `Returned from Stripe, but confirmation is taking longer than expected.${verifiedOrderRef ? ` Keep order reference ${verifiedOrderRef}.` : ""} Please contact support before trying another payment.`;
    }
    return "We're confirming your payment. Please keep this page open.";
  }

  function resetConsent() {
    setTermsAccepted(false);
    setLiabilityWaiverAccepted(false);
  }

  /**
   * Frees the places held by a reviewed draft the guest replaced. The server
   * releases it only while it is still an unpaid draft for this key; a draft
   * whose payment was started is never released from here.
   */
  function releaseReplacedDraft() {
    const orderRef = draft?.persisted ? draft.orderRef : undefined;
    if (!orderRef || paymentIntent?.orderRef === orderRef) return;
    void fetch("/api/order-drafts/checkout/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRef, idempotencyKey }),
      keepalive: true
    }).catch(() => undefined);
  }

  function resetDraft() {
    // Invalidates any review still in flight for the previous order.
    reviewSequence.current += 1;
    releaseReplacedDraft();
    setIsReviewing(false);
    setDraft(null);
    setMessage(null);
    resetConsent();
    if (idempotencyKeyUsed) {
      setIdempotencyKey(createIdempotencyKey());
      setIdempotencyKeyUsed(false);
    }
  }

  function counterMinimum(field: AdmissionPartyField) {
    return field === "adults" ? admissionMinAdults : 0;
  }

  function updateGuests(field: AdmissionPartyField, delta: 1 | -1) {
    if (delta > 0 && partyFull) {
      setPartyLimitNotice(`An order can include up to ${admissionMaxPartySize} visitors, including children.`);
      return;
    }
    if (delta < 0 && party[field] <= counterMinimum(field)) {
      setPartyLimitNotice(
        field === "adults"
          ? `Each order needs at least ${admissionMinAdults} ${admissionAgeCategories.adult.label}.`
          : null
      );
      return;
    }
    setParty((current) => ({ ...current, [field]: current[field] + delta }));
    setPartyLimitNotice(null);
    resetDraft();
  }

  function updateVisitDate(nextVisitDate: string) {
    setVisitDate(nextVisitDate);
    setChosenEntryTime("");
    setAutoEntryTime(true);
    resetDraft();
  }

  function chooseEntryTime(nextEntryTime: string) {
    setChosenEntryTime(nextEntryTime);
    setAutoEntryTime(false);
    resetDraft();
  }

  function availabilityNotice(): { text: string; isError: boolean } {
    if (availabilityPhase === "invalid") return { text: "Choose a valid date.", isError: true };
    if (availabilityPhase === "loading") {
      const hoursHint = operatingHours && selectedWeekday
        ? ` ${selectedWeekday} hours: ${formatOperatingDay(operatingHours[selectedWeekday])}.`
        : "";
      return { text: `Checking live availability…${hoursHint}`, isError: false };
    }
    if (!availability) {
      return {
        text: "Live availability couldn't be loaded, so this order can't be reviewed yet.",
        isError: true
      };
    }
    const dateLabel = formatVisitDateLabel(availability.visitDate);
    switch (availability.dayStatus) {
      case "open": {
        const hours = `${availability.weekday} hours: ${formatOperatingDay(availability.dayHours)}.`;
        if (selectedSlot) {
          return {
            text: `${hours} ${selectedSlot.remaining} of ${availability.capacity} places open at ${entryTimeLabels.get(selectedSlot.entryTime)}.`,
            isError: false
          };
        }
        if (chosenEntryTimeLost) {
          return {
            text: `${entryTimeLabels.get(chosenEntryTime)} no longer has room for ${partySize} visitors. Choose another time.`,
            isError: true
          };
        }
        return { text: `${hours} Choose an entry time.`, isError: false };
      }
      case "full":
        return {
          text: `No entry time on ${dateLabel} has room for ${partySize} visitors. Try a smaller party or another date.`,
          isError: true
        };
      case "past":
        return {
          text: availability.visitDate === availability.today
            ? "Today's entry times have passed. Choose another date."
            : "That date has passed. Choose another date.",
          isError: true
        };
      case "closed":
        return {
          text: `Sky LA has no checkout arrival times on ${availability.weekday}. Choose another date.`,
          isError: true
        };
      case "beyond_horizon":
        return {
          text: `Tickets can be booked up to ${checkoutBookingWindowDays} days ahead. Choose an earlier date.`,
          isError: true
        };
      case "private_event":
        return { text: `${dateLabel} is reserved for a private event. Choose another date.`, isError: true };
      case "unverified":
        return {
          text: "Online availability can't be confirmed for this date. Choose another date or email us.",
          isError: true
        };
    }
  }

  async function reviewOrder() {
    if (!canReview) return;
    const sequence = ++reviewSequence.current;
    setIdempotencyKeyUsed(true);
    setIsReviewing(true);
    setMessage(null);
    resetConsent();

    try {
      const response = await fetch("/api/order-drafts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageKey,
          adults: party.adults,
          children: party.children,
          freeChildren: party.freeChildren,
          addons: {},
          visitDate,
          entryTime,
          customerEmail: normalizedEmail,
          idempotencyKey
        })
      });
      const data = (await response.json()) as DraftResponse | { error?: string; code?: string };
      if (sequence !== reviewSequence.current) return;
      if (!response.ok) {
        if ("code" in data && data.code === "visit_unavailable") {
          // The server's capacity check is authoritative; refresh the slots.
          setAvailabilityReload((current) => current + 1);
        }
        throw new Error("error" in data ? data.error ?? "Could not review this order" : "Could not review this order");
      }
      const nextDraft = data as DraftResponse;
      setDraft(nextDraft);
      if (!nextDraft.persisted) {
        setMessage(
          "Online checkout is temporarily unavailable. Please email reservations@skydeckla.com and we will help with your visit."
        );
      }
    } catch (error) {
      if (sequence !== reviewSequence.current) return;
      setDraft(null);
      setMessage(error instanceof Error ? error.message : "Could not review this order");
    } finally {
      if (sequence === reviewSequence.current) setIsReviewing(false);
    }
  }

  /**
   * Starts card payment for the reviewed order, or returns to the payment
   * this browser already started. The server keeps one Session per order, so
   * a retry after a lost response reopens that Session instead of a new one.
   */
  async function startPayment(resume?: PaymentIntentRecord) {
    // A ref, not state, so two clicks in the same frame cannot both pass.
    if (paymentInFlight.current) return;
    if (!resume && paymentLocked) return;
    if (!resume && (!draft?.persisted || !draft.orderRef)) {
      setMessage("Review and save this order before continuing to payment.");
      return;
    }
    if (!resume && (!termsAccepted || !liabilityWaiverAccepted)) {
      setMessage(
        "Before card payment, check both boxes above: agree to the Terms of Use and Ticket Purchase Terms, and accept the Acknowledgment of Risk and Release of Liability for yourself."
      );
      return;
    }
    const record: PaymentIntentRecord = resume ?? {
      version: 1,
      orderRef: draft!.orderRef!,
      idempotencyKey
    };
    const current = parseStoredPaymentIntent(readStoredPaymentIntentRaw());
    if (current && (current.orderRef !== record.orderRef || current.idempotencyKey !== record.idempotencyKey)) {
      setMessage("Another payment is already being checked. Finish checking it before starting this order.");
      return;
    }
    if (!writeStoredPaymentIntent(record)) {
      setMessage("We couldn't save your payment progress. No payment was started. Please allow this site to save data, or contact our team for help.");
      return;
    }
    paymentInFlight.current = true;
    setIsPaying(true);
    setMessage(null);
    // Stored before the request, so a reload or lost response still knows a
    // payment may have started for this order. Any older status read for it
    // is discarded.
    intentCheckSequence.current += 1;
    setIntentCheck({ orderRef: record.orderRef, status: "pending" });
    setConfirmedIntent(null);

    try {
      const response = await fetch("/api/payments/stripe-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderRef: record.orderRef,
          idempotencyKey: record.idempotencyKey,
          // Accepted when this payment was first started; a resumed attempt
          // reuses the acceptance stored with that order.
          legalAcceptance: {
            termsAccepted: true,
            termsVersion: currentTermsVersion,
            liabilityWaiverAccepted: true,
            liabilityWaiverVersion: currentLiabilityWaiverVersion
          }
        })
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
      if (response.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setMessage(
        data.code === "payment_session_closed"
          ? `The payment page for order ${record.orderRef} has closed without payment. Review your order again to start a new one.`
          : data.error ?? "Card payment could not be opened."
      );
      if (data.code === "payment_session_closed") {
        clearPaymentIntent(record);
        startNewOrder();
        return;
      }
      await checkPaymentIntent(record);
    } catch {
      setMessage(
        "We couldn't confirm that the payment page opened. Your order is held: use Return to payment, which reopens the same payment instead of starting another."
      );
      await checkPaymentIntent(record);
    } finally {
      paymentInFlight.current = false;
      setIsPaying(false);
    }
  }

  function startNewOrder() {
    reviewSequence.current += 1;
    releaseReplacedDraft();
    setIsReviewing(false);
    setIdempotencyKey(createIdempotencyKey());
    setIdempotencyKeyUsed(false);
    setDraft(null);
    resetConsent();
  }

  function intentNotice(): { text: string; tone: "isGood" | "isWarn" } | null {
    if (!paymentIntent || intentStatus === "none") {
      return confirmedIntent
        ? { text: `Payment confirmed for order ${confirmedIntent.orderRef}. Your ticket is ready.`, tone: "isGood" }
        : null;
    }
    const orderRef = paymentIntent.orderRef;
    switch (intentStatus) {
      case "checking":
        return { text: `Checking the card payment started for order ${orderRef}…`, tone: "isWarn" };
      case "awaiting_payment":
        return {
          text: `A card payment for order ${orderRef} is open${
            intentExpiresAt ? ` until ${formatClockTime(intentExpiresAt)} PT` : ""
          }. Return to it to finish paying. A new order stays locked until that payment page closes, so you are not charged twice.`,
          tone: "isWarn"
        };
      case "needs_attention":
        return {
          text: `Your payment for order ${orderRef} needs help from our team before a ticket can be issued. Please don't pay again; email ${supportEmail} with this order reference.`,
          tone: "isWarn"
        };
      case "unknown":
        return {
          text: `We couldn't check the card payment for order ${orderRef}. Check again before starting another order.`,
          tone: "isWarn"
        };
      default:
        return {
          text: `A card payment for order ${orderRef} is still being confirmed. Please don't start another payment yet.`,
          tone: "isWarn"
        };
    }
  }

  const notice = availabilityNotice();
  // A Stripe success return reports through its own Session poll above.
  const recovery = returnedFromStripeSuccess ? null : intentNotice();
  const canResumePayment =
    intentStatus === "awaiting_payment" || intentStatus === "pending" || intentStatus === "unknown";

  return (
    <section className="checkoutShell" aria-label="Ticket checkout">
      {recovery ? (
        <div aria-live="polite" className={`checkoutNotice ${recovery.tone}`} role="status">
          {recovery.text}
          <div className="checkoutActions">
            {!paymentIntent && confirmedIntent?.ticketCode ? (
              <Link className="secondaryAction" href={`/tickets/${encodeURIComponent(confirmedIntent.ticketCode)}`}>
                Open ticket
                <ArrowRight size={18} />
              </Link>
            ) : null}
            {paymentIntent && canResumePayment ? (
              <button
                className="secondaryAction"
                type="button"
                disabled={isPaying}
                onClick={() => void startPayment(paymentIntent)}
              >
                {isPaying ? "Opening..." : "Return to payment"}
                <ArrowRight size={18} />
              </button>
            ) : null}
            {paymentIntent && intentStatus !== "checking" ? (
              <button
                className="checkoutTextButton"
                type="button"
                onClick={() => recheckPaymentIntent(paymentIntent)}
              >
                Check payment status
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {stripeStatus ? (
        <div
          aria-live="polite"
          className={`checkoutNotice ${returnStatus === "confirmed" ? "isGood" : "isWarn"}`}
        >
          {returnNotice()}
          {returnStatus === "confirmed" && verifiedTicketCode ? (
            <div className="checkoutActions">
              <Link className="secondaryAction" href={`/tickets/${encodeURIComponent(verifiedTicketCode)}`}>
                Open ticket
                <ArrowRight size={18} />
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="checkoutForm">
        <div className="checkoutPanel">
          <div className="checkoutPackages" role="radiogroup" aria-label="Ticket package">
            {packages.map((ticket) => (
              <button
                className={ticket.key === packageKey ? "checkoutPackage isSelected" : "checkoutPackage"}
                key={ticket.key}
                type="button"
                role="radio"
                aria-checked={ticket.key === packageKey}
                onClick={() => {
                  setPackageKey(ticket.key);
                  resetDraft();
                }}
              >
                <span className="checkoutPackageName">{ticket.name}</span>
                <span className="checkoutPackageDetail">
                  Observation deck and lounge, timed entry
                </span>
                <strong>
                  {money(ticket.priceCents)} <small>per adult</small>
                </strong>
              </button>
            ))}
          </div>

          <fieldset className="checkoutGuests" aria-describedby="checkout-party-rules">
            <legend>Visitors</legend>
            {visitorCounters.map((counter) => {
              const count = party[counter.field];
              const atMinimum = count <= counterMinimum(counter.field);
              const priceCents = counterPriceCents[counter.field];
              const labelId = `checkout-${counter.field}-label`;
              return (
                <div className="checkoutCounter" key={counter.field} role="group" aria-labelledby={labelId}>
                  <div className="checkoutCounterLabel">
                    <span id={labelId}>{counter.category.label}</span>
                    <em>{priceCents === 0 ? "Free" : `${money(priceCents)} each`}</em>
                  </div>
                  <div className="checkoutStepper">
                    <button
                      type="button"
                      aria-label={counter.fewer}
                      aria-disabled={atMinimum}
                      onClick={() => updateGuests(counter.field, -1)}
                    >
                      &minus;
                    </button>
                    <span aria-live="polite" aria-atomic="true">
                      <span className="srOnly">{counter.category.label}: </span>
                      {count}
                    </span>
                    <button
                      type="button"
                      aria-label={counter.more}
                      aria-disabled={partyFull}
                      onClick={() => updateGuests(counter.field, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
            <dl className="checkoutPartyTotals" aria-live="polite" aria-atomic="true">
              <div>
                <dt>Total visitors</dt>
                <dd>{partySize}</dd>
              </div>
              <div>
                <dt>Estimated total</dt>
                <dd>{money(estimatedTotalCents)}</dd>
              </div>
            </dl>
            <p className="checkoutHours" id="checkout-party-rules">
              Each order needs at least {admissionMinAdults} {admissionAgeCategories.adult.label}. Up to{" "}
              {admissionMaxPartySize} visitors per order, children included. Review Order confirms the exact total.
              {" "}Valid on the selected Los Angeles date, from entry time until closing. One admission for the booked party; no re-entry.
            </p>
            {partyLimitNotice ? (
              <p className="checkoutError" role="status">
                {partyLimitNotice}
              </p>
            ) : null}
          </fieldset>

          <div className="checkoutGrid">
            <label>
              <span>Date</span>
              <input
                aria-describedby="checkout-time-zone"
                max={addVisitDays(todayIso(), checkoutBookingWindowDays)}
                min={todayIso()}
                type="date"
                value={visitDate}
                onChange={(event) => updateVisitDate(event.target.value)}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                inputMode="email"
                placeholder="guest@example.com"
                required
                type="email"
                value={customerEmail}
                onChange={(event) => {
                  setCustomerEmail(event.target.value);
                  resetDraft();
                }}
              />
            </label>
          </div>

          <p className="checkoutTimeZone" id="checkout-time-zone">
            Dates and entry times are Los Angeles time (PT).
          </p>

          <div className="checkoutAvailability" aria-live="polite" aria-atomic="true">
            <p className={notice.isError ? "checkoutError" : "checkoutHours"}>{notice.text}</p>
            {availabilityPhase === "error" ? (
              <button
                className="checkoutTextButton"
                type="button"
                onClick={() => setAvailabilityReload((current) => current + 1)}
              >
                Try again
              </button>
            ) : null}
          </div>

          <div
            aria-busy={availabilityPhase === "loading"}
            aria-label="Entry time, Los Angeles time"
            className="checkoutTimes"
            role="group"
          >
            {checkoutEntryTimes.map((time) => {
              const slot = slotByTime.get(time.value);
              const available = slot?.status === "available";
              const selected = time.value === entryTime;
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "isSelected" : ""}
                  disabled={!available}
                  key={time.value}
                  type="button"
                  onClick={() => chooseEntryTime(time.value)}
                >
                  {time.label}
                  {slot?.status === "full" ? (
                    <small>{slot.remaining === 0 ? "Full" : `${slot.remaining} left`}</small>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="checkoutSummary" aria-labelledby="checkout-summary-title">
        <h2 className="checkoutSummaryTitle" id="checkout-summary-title">
          Order summary
        </h2>

        {draft ? (
          <div className="checkoutLines">
            {draft.draft.lines.map((line) => (
              <div className="checkoutLine" key={`${line.kind}-${line.name}`}>
                <span>{line.name} x {line.quantity}</span>
                <strong>{line.lineTotalCents === 0 ? "Free" : money(line.lineTotalCents)}</strong>
              </div>
            ))}
            <div className="checkoutTotal">
              <span>Total</span>
              <strong>{money(draft.draft.totalCents)}</strong>
            </div>
            <p className="checkoutAllIn">All-in. No fees added at payment.</p>
          </div>
        ) : (
          <div className="checkoutEmpty">Review your order to confirm the exact total.</div>
        )}

        {orderPersisted ? (
          <>
            <div className="checkoutPersisted">
              <ShieldCheck size={18} />
              <span>Stored as {draft?.orderRef}</span>
            </div>

            <fieldset className="checkoutConsent">
              <legend>Before you pay</legend>

              <label className="checkoutConsentOption">
                <input
                  checked={termsAccepted}
                  type="checkbox"
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
                <span>
                  {currentTermsAgeRepresentationText} and agree to the{" "}
                  <a href="/terms" rel="noreferrer" target="_blank">
                    {currentTermsDocumentLabel}
                    <span className="srOnly"> (opens in a new tab)</span>
                  </a>{" "}
                  and the {currentRefundAndVisitPolicyLabel}.
                </span>
              </label>

              <label className="checkoutConsentOption">
                <input
                  checked={liabilityWaiverAccepted}
                  type="checkbox"
                  onChange={(event) => setLiabilityWaiverAccepted(event.target.checked)}
                />
                <span>
                  I have read and voluntarily accept the Sky LA{" "}
                  <a href="/liability-waiver" rel="noreferrer" target="_blank">
                    Acknowledgment of Risk and Release of Liability
                    <span className="srOnly"> (opens in a new tab)</span>
                  </a>{" "}
                  for myself.
                </span>
              </label>

              <p className="checkoutConsentNote">
                Every other adult guest, and a parent or legal guardian for every minor guest, must
                complete a separate waiver before entry.
              </p>

              <p aria-live="polite" className={legalReady ? "checkoutConsentReady isReady" : "checkoutConsentReady"}>
                {legalReady
                  ? "Both acknowledgments are checked. You can continue to card payment."
                  : "Card payment unlocks after both boxes above are checked."}
              </p>
            </fieldset>
          </>
        ) : null}

        {message ? <p className="checkoutError">{message}</p> : null}

        <div className="checkoutActions">
          <button
            className="primaryAction"
            type="button"
            disabled={!canReview || isReviewing || paymentLocked}
            onClick={reviewOrder}
          >
            {isReviewing ? "Reviewing..." : "Review Order"}
          </button>
          <button
            className="secondaryAction"
            type="button"
            disabled={!canPay}
            onClick={() => void startPayment()}
          >
            {isPaying ? "Starting..." : "Continue to Card Payment"}
            <ArrowRight size={18} />
          </button>
          <button
            className="checkoutTextButton"
            type="button"
            disabled={paymentLocked}
            onClick={() => {
              setMessage(null);
              startNewOrder();
            }}
          >
            New order
          </button>
        </div>
      </aside>
    </section>
  );
}
