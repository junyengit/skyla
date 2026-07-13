"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { checkoutEntryTimes, type AddonKey, type TicketPackageKey } from "@skyla/payments";
import { ArrowRight, CalendarDays, ShieldCheck } from "@skyla/ui/icons";
import {
  formatOperatingDay,
  isCheckoutEntryTimeAvailable,
  operatingWeekdayForDate,
  type OperatingHours
} from "@/lib/operating-hours";

type PackageOption = {
  key: TicketPackageKey;
  name: string;
  priceCents: number;
};

type AddonOption = {
  key: AddonKey;
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
  addons: AddonOption[];
  stripeStatus?: "success" | "cancel";
  returnedCheckoutSessionId?: string;
  operatingHours?: OperatingHours | null;
};

type AddonQuantities = Partial<Record<AddonKey, number>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ticketCodePattern = /^tkt_[a-f0-9]{32}$/;

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
  addons,
  stripeStatus,
  returnedCheckoutSessionId,
  operatingHours = null
}: CheckoutClientProps) {
  const initialVisitDate = todayIso();
  const [packageKey, setPackageKey] = useState<TicketPackageKey>(packages[0]?.key ?? "general");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [visitDate, setVisitDate] = useState(initialVisitDate);
  const [entryTime, setEntryTime] = useState<string>(() => {
    if (!operatingHours) return checkoutEntryTimes[0].value;
    return (
      checkoutEntryTimes.find((time) =>
        isCheckoutEntryTimeAvailable(operatingHours, initialVisitDate, time.value)
      )?.value ?? ""
    );
  });
  const [customerEmail, setCustomerEmail] = useState("");
  const [addonQuantities, setAddonQuantities] = useState<AddonQuantities>({});
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [returnStatus, setReturnStatus] = useState<"checking" | "pending" | "confirmed" | "failed" | "canceled" | "unavailable">(
    stripeStatus === "success" ? "checking" : "pending"
  );
  const [verifiedOrderRef, setVerifiedOrderRef] = useState<string | null>(null);
  const [verifiedBookingRef, setVerifiedBookingRef] = useState<string | null>(null);
  const [verifiedTicketCode, setVerifiedTicketCode] = useState<string | null>(null);

  const selectedPackage = packages.find((item) => item.key === packageKey) ?? packages[0];
  const normalizedEmail = customerEmail.trim().toLowerCase();
  const selectedWeekday = operatingWeekdayForDate(visitDate);
  const availableEntryTimes = operatingHours
    ? checkoutEntryTimes.filter((time) =>
        isCheckoutEntryTimeAvailable(operatingHours, visitDate, time.value)
      )
    : checkoutEntryTimes;
  const selectedEntryTimeAvailable = operatingHours
    ? isCheckoutEntryTimeAvailable(operatingHours, visitDate, entryTime)
    : Boolean(entryTime);
  const canReview =
    !!selectedPackage &&
    adults > 0 &&
    !!visitDate &&
    selectedEntryTimeAvailable &&
    emailPattern.test(normalizedEmail);
  const addonInput = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(addonQuantities).filter(([, quantity]) => Number(quantity) > 0)
      ) as AddonQuantities,
    [addonQuantities]
  );

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

  function resetDraft() {
    setDraft(null);
    setMessage(null);
  }

  function updateAddon(key: AddonKey, delta: number) {
    setAddonQuantities((current) => {
      const next = Math.max(0, (current[key] ?? 0) + delta);
      return { ...current, [key]: next };
    });
    resetDraft();
  }

  function updateVisitDate(nextVisitDate: string) {
    const firstAvailableEntryTime = operatingHours
      ? checkoutEntryTimes.find((time) =>
          isCheckoutEntryTimeAvailable(operatingHours, nextVisitDate, time.value)
        )?.value ?? ""
      : checkoutEntryTimes[0].value;

    setVisitDate(nextVisitDate);
    setEntryTime((current) =>
      !operatingHours || isCheckoutEntryTimeAvailable(operatingHours, nextVisitDate, current)
        ? current
        : firstAvailableEntryTime
    );
    resetDraft();
  }

  async function reviewOrder() {
    if (!canReview) return;
    setIsReviewing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/order-drafts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageKey,
          adults,
          children,
          addons: addonInput,
          visitDate,
          entryTime,
          customerEmail: normalizedEmail,
          idempotencyKey
        })
      });
      const data = (await response.json()) as DraftResponse | { error?: string };
      if (!response.ok) {
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
      setDraft(null);
      setMessage(error instanceof Error ? error.message : "Could not review this order");
    } finally {
      setIsReviewing(false);
    }
  }

  async function startPayment() {
    if (!draft?.persisted || !draft.orderRef) {
      setMessage("Review and save this order before continuing to payment.");
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
          idempotencyKey
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
    setIdempotencyKey(createIdempotencyKey());
    setDraft(null);
    setMessage(null);
  }

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
          <div className="checkoutPanelHeader">
            <span>1</span>
            <div>
              <h2>Visit</h2>
              <p>Select the ticket type and arrival window.</p>
            </div>
          </div>

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
                <span>{ticket.name}</span>
                <strong>{money(ticket.priceCents)}</strong>
              </button>
            ))}
          </div>

          <div className="checkoutGrid">
            <label>
              <span>Adults</span>
              <input
                min={1}
                max={20}
                type="number"
                value={adults}
                onChange={(event) => {
                  setAdults(Number(event.target.value));
                  resetDraft();
                }}
              />
            </label>
            <label>
              <span>Children</span>
              <input
                min={0}
                max={20}
                type="number"
                value={children}
                onChange={(event) => {
                  setChildren(Number(event.target.value));
                  resetDraft();
                }}
              />
            </label>
            <label>
              <span>Date</span>
              <input
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

          {operatingHours && selectedWeekday ? (
            <p
              aria-live="polite"
              className={availableEntryTimes.length === 0 ? "checkoutError" : undefined}
            >
              {availableEntryTimes.length === 0
                ? `Sky LA has no checkout arrival times on ${selectedWeekday}. Choose another date.`
                : `${selectedWeekday} hours: ${formatOperatingDay(operatingHours[selectedWeekday])}.`}
            </p>
          ) : null}

          <div className="checkoutTimes" aria-label="Entry time">
            {checkoutEntryTimes.map((time) => {
              const available =
                !operatingHours || isCheckoutEntryTimeAvailable(operatingHours, visitDate, time.value);
              return (
                <button
                  className={time.value === entryTime ? "isSelected" : ""}
                  disabled={!available}
                  key={time.value}
                  style={available ? undefined : { cursor: "not-allowed", opacity: 0.38 }}
                  type="button"
                  onClick={() => {
                    setEntryTime(time.value);
                    resetDraft();
                  }}
                >
                  {time.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="checkoutPanel">
          <div className="checkoutPanelHeader">
            <span>2</span>
            <div>
              <h2>Add-ons</h2>
              <p>Optional cafe vouchers for the visit.</p>
            </div>
          </div>

          <div className="checkoutAddons">
            {addons.map((addon) => (
              <div className="checkoutAddon" key={addon.key}>
                <div>
                  <strong>{addon.name}</strong>
                  <span>{money(addon.priceCents)}</span>
                </div>
                <div className="checkoutStepper">
                  <button type="button" onClick={() => updateAddon(addon.key, -1)} aria-label={`Remove ${addon.name}`}>
                    -
                  </button>
                  <span>{addonQuantities[addon.key] ?? 0}</span>
                  <button type="button" onClick={() => updateAddon(addon.key, 1)} aria-label={`Add ${addon.name}`}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="checkoutSummary" aria-label="Order summary">
        <div className="checkoutPanelHeader">
          <span>
            <CalendarDays size={18} />
          </span>
          <div>
            <h2>Order</h2>
            <p>{selectedPackage ? selectedPackage.name : "Ticket package"}</p>
          </div>
        </div>

        {draft ? (
          <div className="checkoutLines">
            {draft.draft.lines.map((line) => (
              <div className="checkoutLine" key={`${line.kind}-${line.productKey ?? line.name}`}>
                <span>{line.name} x {line.quantity}</span>
                <strong>{money(line.lineTotalCents)}</strong>
              </div>
            ))}
            <div className="checkoutLine">
              <span>Subtotal</span>
              <strong>{money(draft.draft.subtotalCents)}</strong>
            </div>
            <div className="checkoutLine">
              <span>Booking fee</span>
              <strong>{money(draft.draft.feeCents)}</strong>
            </div>
            <div className="checkoutTotal">
              <span>Total</span>
              <strong>{money(draft.draft.totalCents)}</strong>
            </div>
          </div>
        ) : (
          <div className="checkoutEmpty">Review the order to fetch the server total.</div>
        )}

        {draft?.persisted && draft.orderRef ? (
          <div className="checkoutPersisted">
            <ShieldCheck size={18} />
            <span>Stored as {draft.orderRef}</span>
          </div>
        ) : null}

        {message ? <p className="checkoutError">{message}</p> : null}

        <div className="checkoutActions">
          <button className="primaryAction" type="button" disabled={!canReview || isReviewing} onClick={reviewOrder}>
            {isReviewing ? "Reviewing..." : "Review Order"}
          </button>
          <button
            className="secondaryAction"
            type="button"
            disabled={!draft?.persisted || isPaying}
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
