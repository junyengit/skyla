"use client";

import { useMemo, useRef, useState } from "react";
import type { CafeItemKey, TicketPackageKey } from "@skyla/payments";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";

type TicketOption = {
  key: TicketPackageKey;
  name: string;
  priceCents: number;
};

type CafeOption = {
  key: CafeItemKey;
  name: string;
  priceCents: number;
  category: "matcha" | "coffee" | "bites";
};

type CartLine =
  | { id: string; kind: "ticket"; packageKey: TicketPackageKey; name: string; quantity: number }
  | { id: string; kind: "cafe"; itemKey: CafeItemKey; name: string; quantity: number }
  | {
      id: string;
      kind: "custom";
      name: string;
      amountCents: number;
      quantity: number;
      reason: string;
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

type PosDraftResponse = {
  draft: {
    status: "draft";
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
    saleRef?: string;
    lines: DraftLine[];
  };
  saleRef?: string;
  persisted: boolean;
  persistenceReason?: "convex_unconfigured" | "idempotencyKey_required" | "staff_auth_required";
};

type PosDraftClientProps = {
  tickets: TicketOption[];
  cafeItems: CafeOption[];
};

type Tab = "tickets" | "cafe" | "custom";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
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

export function PosDraftClient({ tickets, cafeItems }: PosDraftClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("tickets");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [draft, setDraft] = useState<PosDraftResponse | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reviewVersionRef = useRef(0);

  const activeCafeItems = useMemo(
    () =>
      cafeItems.filter((item) => {
        if (activeTab === "cafe") return true;
        return false;
      }),
    [activeTab, cafeItems]
  );

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const clientPreviewCents = cart.reduce((sum, line) => {
    const unitAmountCents =
      line.kind === "custom"
        ? line.amountCents
        : line.kind === "ticket"
          ? tickets.find((ticket) => ticket.key === line.packageKey)?.priceCents ?? 0
          : cafeItems.find((item) => item.key === line.itemKey)?.priceCents ?? 0;
    return sum + unitAmountCents * line.quantity;
  }, 0);

  function resetReview() {
    reviewVersionRef.current += 1;
    setDraft(null);
    setMessage(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function addCatalogLine(line: Extract<CartLine, { kind: "ticket" | "cafe" }>) {
    setCart((current) => {
      const existing = current.find((item) => item.id === line.id);
      if (existing) {
        return current.map((item) =>
          item.id === line.id ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item
        );
      }
      return [...current, line];
    });
    resetReview();
  }

  function addCustomLine() {
    const amountCents = customCents(customAmount);
    if (!amountCents || amountCents < 50) {
      setMessage("Custom charge must be at least $0.50.");
      return;
    }
    if (!customReason.trim()) {
      setMessage("Custom charge requires a reason.");
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `custom:${crypto.randomUUID()}`
        : `custom:${idempotencyKey}:${cart.length}:${customName.trim() || "charge"}`;
    setCart((current) => [
      ...current,
      {
        id,
        kind: "custom",
        name: customName.trim() || "Custom charge",
        amountCents,
        quantity: 1,
        reason: customReason.trim()
      }
    ]);
    setCustomName("");
    setCustomAmount("");
    setCustomReason("");
    resetReview();
  }

  function updateQuantity(id: string, delta: number) {
    setCart((current) =>
      current
        .map((line) => (line.id === id ? { ...line, quantity: Math.max(0, Math.min(99, line.quantity + delta)) } : line))
        .filter((line) => line.quantity > 0)
    );
    resetReview();
  }

  function clearCart() {
    setCart([]);
    resetReview();
  }

  function linePayload(line: CartLine) {
    if (line.kind === "ticket") {
      return { kind: "ticket" as const, packageKey: line.packageKey, quantity: line.quantity };
    }
    if (line.kind === "cafe") {
      return { kind: "cafe" as const, itemKey: line.itemKey, quantity: line.quantity };
    }
    return {
      kind: "custom" as const,
      name: line.name,
      amountCents: line.amountCents,
      quantity: line.quantity,
      reason: line.reason
    };
  }

  async function reviewSale() {
    if (cart.length === 0) {
      setMessage("Cart is empty.");
      return;
    }
    setIsReviewing(true);
    setMessage(null);
    const reviewVersion = reviewVersionRef.current;
    const lines = cart.map(linePayload);
    const email = customerEmail || undefined;

    try {
      const response = await fetch("/api/order-drafts/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          customerEmail: email,
          idempotencyKey
        })
      });
      const data = (await response.json()) as PosDraftResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error ?? "Could not review this sale" : "Could not review this sale");
      }
      if (reviewVersion !== reviewVersionRef.current) {
        return;
      }
      const nextDraft = data as PosDraftResponse;
      setDraft(nextDraft);
      setMessage(
        nextDraft.persisted
          ? "Sale draft stored in Convex."
          : "Server total reviewed. Terminal payment remains locked for the saleRef-only Stripe action."
      );
    } catch (error) {
      setDraft(null);
      setMessage(error instanceof Error ? error.message : "Could not review this sale");
    } finally {
      setIsReviewing(false);
    }
  }

  return (
    <section className="posNextShell" aria-label="POS sale draft">
      <div className="posNextCatalog">
        <div className="posNextToolbar" role="tablist" aria-label="POS catalog">
          <button
            className={activeTab === "tickets" ? "isActive" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "tickets"}
            onClick={() => setActiveTab("tickets")}
          >
            Tickets
          </button>
          <button
            className={activeTab === "cafe" ? "isActive" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "cafe"}
            onClick={() => setActiveTab("cafe")}
          >
            Cafe
          </button>
          <button
            className={activeTab === "custom" ? "isActive" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === "custom"}
            onClick={() => setActiveTab("custom")}
          >
            Custom
          </button>
        </div>

        {activeTab === "tickets" ? (
          <div className="posNextGrid" role="tabpanel">
            {tickets.map((ticket) => (
              <button
                className="posNextItem"
                key={ticket.key}
                type="button"
                onClick={() =>
                  addCatalogLine({
                    id: `ticket:${ticket.key}`,
                    kind: "ticket",
                    packageKey: ticket.key,
                    name: ticket.name,
                    quantity: 1
                  })
                }
              >
                <span>{ticket.name}</span>
                <strong>{money(ticket.priceCents)}</strong>
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === "cafe" ? (
          <div className="posNextGrid" role="tabpanel">
            {activeCafeItems.map((item) => (
              <button
                className="posNextItem"
                key={item.key}
                type="button"
                onClick={() =>
                  addCatalogLine({
                    id: `cafe:${item.key}`,
                    kind: "cafe",
                    itemKey: item.key,
                    name: item.name,
                    quantity: 1
                  })
                }
              >
                <span>{item.name}</span>
                <strong>{money(item.priceCents)}</strong>
              </button>
            ))}
          </div>
        ) : null}

        {activeTab === "custom" ? (
          <div className="posNextCustom" role="tabpanel">
            <label>
              <span>Name</span>
              <input value={customName} onChange={(event) => setCustomName(event.target.value)} />
            </label>
            <label>
              <span>Amount</span>
              <input
                inputMode="decimal"
                placeholder="12.00"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
              />
            </label>
            <label>
              <span>Reason</span>
              <input value={customReason} onChange={(event) => setCustomReason(event.target.value)} />
            </label>
            <button className="primaryAction" type="button" onClick={addCustomLine}>
              Add Custom
            </button>
          </div>
        ) : null}
      </div>

      <aside className="posNextCart" aria-label="POS cart">
        <div className="posNextCartHeader">
          <div>
            <p>Current Sale</p>
            <h2>{cartCount} items</h2>
          </div>
          <ShieldCheck size={24} />
        </div>

        <div className="posNextLines">
          {cart.length === 0 ? (
            <p className="posNextEmpty">No items</p>
          ) : (
            cart.map((line) => (
              <div className="posNextLine" key={line.id}>
                <div>
                  <strong>{line.name}</strong>
                  <span>
                    {line.kind === "custom"
                      ? money(line.amountCents)
                      : line.kind === "ticket"
                        ? "Ticket"
                        : "Cafe"}
                  </span>
                </div>
                <div className="posNextStepper">
                  <button type="button" onClick={() => updateQuantity(line.id, -1)} aria-label={`Remove ${line.name}`}>
                    -
                  </button>
                  <span>{line.quantity}</span>
                  <button type="button" onClick={() => updateQuantity(line.id, 1)} aria-label={`Add ${line.name}`}>
                    +
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <label className="posNextEmail">
          <span>Email</span>
          <input
            inputMode="email"
            placeholder="guest@example.com"
            type="email"
            value={customerEmail}
            onChange={(event) => {
              setCustomerEmail(event.target.value);
              resetReview();
            }}
          />
        </label>

        <div className="posNextTotals">
          <div>
            <span>Local Preview</span>
            <strong>{money(clientPreviewCents)}</strong>
          </div>
          <div>
            <span>Server Total</span>
            <strong>{draft ? money(draft.draft.totalCents) : "Not reviewed"}</strong>
          </div>
          {draft?.saleRef ? (
            <div>
              <span>Sale Ref</span>
              <strong>{draft.saleRef}</strong>
            </div>
          ) : null}
        </div>

        {draft ? (
          <div className="posNextReviewed" aria-label="Reviewed lines">
            {draft.draft.lines.map((line) => (
              <div className="posNextReviewedLine" key={`${line.kind}:${line.productKey ?? line.name}`}>
                <span>{line.name}</span>
                <strong>{money(line.lineTotalCents)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {message ? <p className="posNextMessage">{message}</p> : null}

        <div className="posNextActions">
          <button className="primaryAction" type="button" disabled={isReviewing || cart.length === 0} onClick={reviewSale}>
            {isReviewing ? "Reviewing" : "Review Sale"}
            <ArrowRight size={18} />
          </button>
          <button className="secondaryAction" type="button" disabled>
            Terminal Payment
          </button>
          <button className="checkoutTextButton" type="button" onClick={clearCart}>
            Clear Sale
          </button>
        </div>
      </aside>
    </section>
  );
}
