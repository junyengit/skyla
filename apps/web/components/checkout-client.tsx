"use client";

import { useMemo, useState } from "react";
import type { AddonKey, TicketPackageKey } from "@skyla/payments";
import { ArrowRight, CalendarDays, ShieldCheck } from "@skyla/ui/icons";

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
  returnedOrderRef?: string;
};

type AddonQuantities = Partial<Record<AddonKey, number>>;

const entryTimes = ["11:00 AM", "12:30 PM", "2:00 PM", "3:30 PM", "5:00 PM", "6:30 PM"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `checkout_${crypto.randomUUID()}`;
  }
  return `checkout_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function CheckoutClient({
  packages,
  addons,
  stripeStatus,
  returnedOrderRef
}: CheckoutClientProps) {
  const [packageKey, setPackageKey] = useState<TicketPackageKey>(packages[0]?.key ?? "general");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [visitDate, setVisitDate] = useState(todayIso);
  const [entryTime, setEntryTime] = useState(entryTimes[0]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [addonQuantities, setAddonQuantities] = useState<AddonQuantities>({});
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPackage = packages.find((item) => item.key === packageKey) ?? packages[0];
  const canReview = !!selectedPackage && adults > 0 && !!visitDate && !!entryTime;
  const addonInput = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(addonQuantities).filter(([, quantity]) => Number(quantity) > 0)
      ) as AddonQuantities,
    [addonQuantities]
  );

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
          customerEmail: customerEmail || undefined,
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
        setMessage("Online card checkout is waiting on the Convex dashboard connection. Reservations can still be handled by email.");
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
      setMessage("Payment is locked until this order is stored in Convex.");
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
        <div className={`checkoutNotice ${stripeStatus === "success" ? "isGood" : "isWarn"}`}>
          {stripeStatus === "success"
            ? `Stripe returned successfully${returnedOrderRef ? ` for ${returnedOrderRef}` : ""}. Webhook reconciliation marks the stored order paid.`
            : "Payment was canceled before completion."}
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
                onChange={(event) => {
                  setVisitDate(event.target.value);
                  resetDraft();
                }}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                inputMode="email"
                placeholder="guest@example.com"
                type="email"
                value={customerEmail}
                onChange={(event) => {
                  setCustomerEmail(event.target.value);
                  resetDraft();
                }}
              />
            </label>
          </div>

          <div className="checkoutTimes" aria-label="Entry time">
            {entryTimes.map((time) => (
              <button
                className={time === entryTime ? "isSelected" : ""}
                key={time}
                type="button"
                onClick={() => {
                  setEntryTime(time);
                  resetDraft();
                }}
              >
                {time}
              </button>
            ))}
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
