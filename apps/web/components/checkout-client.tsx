"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const [returnStatus, setReturnStatus] = useState<"checking" | "pending" | "confirmed" | "failed" | "canceled" | "unavailable">(
    stripeStatus === "success" ? "checking" : "pending"
  );
  const [verifiedOrderRef, setVerifiedOrderRef] = useState<string | null>(null);
  const [verifiedBookingRef, setVerifiedBookingRef] = useState<string | null>(null);
  const [verifiedTicketCode, setVerifiedTicketCode] = useState<string | null>(null);

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
  const canPay = orderPersisted && legalReady && !isPaying;

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
          status?: "pending" | "confirmed" | "failed" | "canceled";
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
    if (stripeStatus === "cancel") return "Payment was canceled before completion.";
    if (!returnedCheckoutSessionId) {
      return "Returned from Stripe, but the confirmation identity is incomplete. Please contact support before trying another payment.";
    }
    if (returnStatus === "confirmed") {
      return `Payment confirmed. Booking ${verifiedOrderRef} was created.${
        verifiedBookingRef ? ` Booking reference ${verifiedBookingRef}.` : ""
      }`;
    }
    if (returnStatus === "failed") return "Stripe reported that the payment failed. No booking was confirmed.";
    if (returnStatus === "canceled") return "The payment expired or was canceled. No booking was confirmed.";
    if (returnStatus === "unavailable") {
      return `Returned from Stripe, but confirmation is taking longer than expected.${verifiedOrderRef ? ` Keep order reference ${verifiedOrderRef}.` : ""} Please contact support before trying another payment.`;
    }
    return "Returned from Stripe. Waiting for the signed payment webhook.";
  }

  function resetConsent() {
    setTermsAccepted(false);
    setLiabilityWaiverAccepted(false);
  }

  function resetDraft() {
    // Invalidates any review still in flight for the previous order.
    reviewSequence.current += 1;
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

  async function startPayment() {
    if (!draft?.persisted || !draft.orderRef) {
      setMessage("Review and save this order before continuing to payment.");
      return;
    }
    if (!termsAccepted || !liabilityWaiverAccepted) {
      setMessage(
        "Before card payment, check both boxes above: agree to the Terms of Use and Ticket Purchase Terms, and accept the Acknowledgment of Risk and Release of Liability for yourself."
      );
      return;
    }
    setIsPaying(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payments/stripe-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderRef: draft.orderRef,
          idempotencyKey,
          legalAcceptance: {
            termsAccepted,
            termsVersion: currentTermsVersion,
            liabilityWaiverAccepted,
            liabilityWaiverVersion: currentLiabilityWaiverVersion
          }
        })
      });
      const data = (await response.json()) as { url?: string; error?: string; code?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "Could not start card checkout");
      }
      window.location.href = data.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start card checkout");
    } finally {
      setIsPaying(false);
    }
  }

  function startNewOrder() {
    reviewSequence.current += 1;
    setIsReviewing(false);
    setIdempotencyKey(createIdempotencyKey());
    setIdempotencyKeyUsed(false);
    setDraft(null);
    setMessage(null);
    resetConsent();
  }

  const notice = availabilityNotice();

  return (
    <section className="checkoutShell" aria-label="Ticket checkout">
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
          <button className="primaryAction" type="button" disabled={!canReview || isReviewing} onClick={reviewOrder}>
            {isReviewing ? "Reviewing..." : "Review Order"}
          </button>
          <button
            className="secondaryAction"
            type="button"
            disabled={!canPay}
            onClick={startPayment}
          >
            {isPaying ? "Starting..." : "Continue to Card Payment"}
            <ArrowRight size={18} />
          </button>
          <button className="checkoutTextButton" type="button" onClick={startNewOrder}>
            New order
          </button>
        </div>
      </aside>
    </section>
  );
}
