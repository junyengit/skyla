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
    readerId?: string;
    terminalLocationId?: string;
    lines: DraftLine[];
  };
  saleRef?: string;
  persisted: boolean;
  persistenceReason?: "convex_unconfigured" | "idempotencyKey_required" | "staff_auth_required";
};

type TerminalProcessResponse = {
  saleRef: string;
  provider: "terminal";
  paymentIntentId: string;
  readerId: string;
  amountCents: number;
  currency: "usd";
  status: "processing" | "failed";
  readerStatus: string;
  readerActionStatus: string;
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
  const [staffToken, setStaffToken] = useState("");
  const [readerId, setReaderId] = useState("");
  const [terminalLocationId, setTerminalLocationId] = useState("");
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [draft, setDraft] = useState<PosDraftResponse | null>(null);
  const [terminalResult, setTerminalResult] = useState<TerminalProcessResponse | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSendingTerminal, setIsSendingTerminal] = useState(false);
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
    setTerminalResult(null);
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
    const token = staffToken.trim();
    const storedReaderId = readerId.trim() || undefined;
    const storedTerminalLocationId = terminalLocationId.trim() || undefined;

    try {
      const response = await fetch("/api/order-drafts/pos", {
        method: "POST",
        headers: token
          ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          customerEmail: email,
          readerId: storedReaderId,
          terminalLocationId: storedTerminalLocationId,
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
      setTerminalResult(null);
      setMessage(
        nextDraft.persisted
          ? nextDraft.draft.readerId
            ? "Sale draft stored in Convex. Terminal handoff is ready for the stored reader."
            : "Sale draft stored in Convex. Add a reader ID before review to enable Terminal handoff."
          : "Server total reviewed. Terminal payment requires Convex, staff auth, and a stored reader."
      );
    } catch (error) {
      setDraft(null);
      setTerminalResult(null);
      setMessage(error instanceof Error ? error.message : "Could not review this sale");
    } finally {
      setIsReviewing(false);
    }
  }

  async function sendToTerminalReader() {
    const saleRef = draft?.saleRef ?? draft?.draft.saleRef;
    const token = staffToken.trim();
    if (!draft?.persisted || !saleRef) {
      setMessage("Store the sale in Convex before sending it to a reader.");
      return;
    }
    if (!draft.draft.readerId) {
      setMessage("Review the sale with a Stripe reader ID before sending it to Terminal.");
      return;
    }
    if (!token) {
      setMessage("Staff bearer token is required before sending Terminal payment.");
      return;
    }

    setIsSendingTerminal(true);
    setTerminalResult(null);
    setMessage(null);

    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      };
      const body = JSON.stringify({
        saleRef,
        idempotencyKey
      });

      const intentResponse = await fetch("/api/payments/stripe-terminal", {
        method: "POST",
        headers,
        body
      });
      const intentData = (await intentResponse.json()) as { error?: string; amountCents?: number };
      if (!intentResponse.ok) {
        throw new Error(intentData.error ?? "Could not create Terminal PaymentIntent");
      }

      const processResponse = await fetch("/api/payments/stripe-terminal/process", {
        method: "POST",
        headers,
        body
      });
      const processData = (await processResponse.json()) as TerminalProcessResponse | { error?: string };
      if (!processResponse.ok) {
        throw new Error("error" in processData ? processData.error ?? "Could not send sale to reader" : "Could not send sale to reader");
      }

      const nextResult = processData as TerminalProcessResponse;
      setTerminalResult(nextResult);
      setMessage(
        nextResult.status === "failed"
          ? "Reader handoff failed. Keep the sale open and retry or cancel from the dashboard."
          : "Sale sent to the stored reader. Wait for Stripe confirmation before treating it as paid."
      );
    } catch (error) {
      setTerminalResult(null);
      setMessage(error instanceof Error ? error.message : "Could not send sale to reader");
    } finally {
      setIsSendingTerminal(false);
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

        <div className="posNextTerminalSetup" aria-label="Terminal setup">
          <label>
            <span>Staff Token</span>
            <input
              autoComplete="off"
              placeholder="Bearer token"
              type="password"
              value={staffToken}
              onChange={(event) => {
                setStaffToken(event.target.value);
                resetReview();
              }}
            />
          </label>
          <label>
            <span>Reader ID</span>
            <input
              autoComplete="off"
              placeholder="tmr_..."
              value={readerId}
              onChange={(event) => {
                setReaderId(event.target.value);
                resetReview();
              }}
            />
          </label>
          <label>
            <span>Location ID</span>
            <input
              autoComplete="off"
              placeholder="tml_..."
              value={terminalLocationId}
              onChange={(event) => {
                setTerminalLocationId(event.target.value);
                resetReview();
              }}
            />
          </label>
        </div>

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
          {draft?.draft.readerId ? (
            <div>
              <span>Reader</span>
              <strong>{draft.draft.readerId}</strong>
            </div>
          ) : null}
          {terminalResult ? (
            <div>
              <span>Terminal</span>
              <strong>{terminalResult.status}</strong>
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
          <button
            className="secondaryAction"
            type="button"
            disabled={
              isReviewing ||
              isSendingTerminal ||
              !draft?.persisted ||
              !draft.saleRef ||
              !draft.draft.readerId ||
              !staffToken.trim()
            }
            onClick={sendToTerminalReader}
          >
            {isSendingTerminal ? "Sending to Reader" : "Send to Reader"}
          </button>
          <button className="checkoutTextButton" type="button" onClick={clearCart}>
            Clear Sale
          </button>
        </div>
      </aside>
    </section>
  );
}
