"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CafeItemKey, TicketPackageKey } from "@skyla/payments";
import { ArrowRight, ShieldCheck } from "@skyla/ui/icons";
import { useStaffSession } from "@/components/staff-auth-provider";

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
  tickets: TicketOption[];
  cafeItems: CafeOption[];
  terminalAccepted: boolean;
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

function readerOptionKey(option: TerminalReaderOption) {
  return `${option.readerId}@${option.terminalLocationId ?? ""}`;
}

export function PosDraftClient({ tickets, cafeItems, terminalAccepted }: PosDraftClientProps) {
  const staffSession = useStaffSession();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<Tab>("tickets");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [readerOptions, setReaderOptions] = useState<TerminalReaderOption[]>([]);
  const [selectedReaderKey, setSelectedReaderKey] = useState("");
  const [isLoadingReaders, setIsLoadingReaders] = useState(false);
  const [readerMessage, setReaderMessage] = useState<string | null>(null);
  const [authorizedStaff, setAuthorizedStaff] = useState<TerminalReadersResponse["staff"] | null>(null);
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
  const authEpochRef = useRef(0);

  const activeCafeItems = useMemo(
    () =>
      cafeItems.filter((item) => {
        if (activeTab === "cafe") return true;
        return false;
      }),
    [activeTab, cafeItems]
  );

  const selectedReader = useMemo(
    () => readerOptions.find((option) => readerOptionKey(option) === selectedReaderKey),
    [readerOptions, selectedReaderKey]
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

  useEffect(() => {
    return () => {
      authEpochRef.current += 1;
      reviewVersionRef.current += 1;
    };
  }, []);

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

  async function loadTerminalReaders() {
    const authEpoch = authEpochRef.current;
    setIsLoadingReaders(true);
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
        if (readers.some((option) => readerOptionKey(option) === current)) {
          return current;
        }
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
      setReaderMessage(error instanceof Error ? error.message : "Could not load authorized readers");
      resetReview();
    } finally {
      if (authEpoch === authEpochRef.current) setIsLoadingReaders(false);
    }
  }

  async function reviewSale() {
    const authEpoch = authEpochRef.current;
    if (cart.length === 0) {
      setMessage("Cart is empty.");
      return;
    }
    if (selectedReaderKey && !selectedReader) {
      setMessage("Reload the authorized reader list before reviewing this sale.");
      return;
    }
    setIsReviewing(true);
    setMessage(null);
    const reviewVersion = reviewVersionRef.current;
    const lines = cart.map(linePayload);
    const email = customerEmail || undefined;
    const storedReaderId = selectedReader?.readerId;

    try {
      const response = await staffSession.staffFetch("/api/order-drafts/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines,
          customerEmail: email,
          readerId: storedReaderId,
          idempotencyKey
        })
      });
      const data = (await response.json()) as PosDraftResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error ?? "Could not review this sale" : "Could not review this sale");
      }
      if (reviewVersion !== reviewVersionRef.current || authEpoch !== authEpochRef.current) {
        return;
      }
      const nextDraft = data as PosDraftResponse;
      setDraft(nextDraft);
      setTerminalResult(null);
      setMessage(
        nextDraft.persisted
          ? !terminalAccepted
            ? "Sale draft stored in Convex. Reader handoff remains locked until test-reader acceptance is enabled."
            : nextDraft.draft.readerId
              ? "Sale draft stored in Convex. Terminal handoff is ready for the stored reader."
              : "Sale draft stored in Convex. Select an authorized reader before review to enable Terminal handoff."
          : "Server total reviewed. Terminal payment requires Convex, staff auth, and a stored reader."
      );
    } catch (error) {
      if (reviewVersion !== reviewVersionRef.current || authEpoch !== authEpochRef.current) return;
      setDraft(null);
      setTerminalResult(null);
      setMessage(error instanceof Error ? error.message : "Could not review this sale");
    } finally {
      if (authEpoch === authEpochRef.current) setIsReviewing(false);
    }
  }

  async function sendToTerminalReader() {
    const authEpoch = authEpochRef.current;
    const saleRef = draft?.saleRef ?? draft?.draft.saleRef;
    if (!terminalAccepted) {
      setMessage("Reader handoff remains locked until test-reader acceptance is enabled.");
      return;
    }
    if (!draft?.persisted || !saleRef) {
      setMessage("Store the sale in Convex before sending it to a reader.");
      return;
    }
    if (!draft.draft.readerId) {
      setMessage("Review the sale with an authorized Stripe reader before sending it to Terminal.");
      return;
    }
    setIsSendingTerminal(true);
    setTerminalResult(null);
    setMessage(null);

    try {
      const headers = {
        "Content-Type": "application/json"
      };
      const body = JSON.stringify({
        saleRef,
        idempotencyKey
      });

      const intentResponse = await staffSession.staffFetch("/api/payments/stripe-terminal", {
        method: "POST",
        headers,
        body
      });
      const intentData = (await intentResponse.json()) as { error?: string; amountCents?: number };
      if (!intentResponse.ok) {
        throw new Error(intentData.error ?? "Could not create Terminal PaymentIntent");
      }
      if (authEpoch !== authEpochRef.current) return;

      const processResponse = await staffSession.staffFetch("/api/payments/stripe-terminal/process", {
        method: "POST",
        headers,
        body
      });
      const processData = (await processResponse.json()) as TerminalProcessResponse | { error?: string };
      if (!processResponse.ok) {
        throw new Error("error" in processData ? processData.error ?? "Could not send sale to reader" : "Could not send sale to reader");
      }
      if (authEpoch !== authEpochRef.current) return;

      const nextResult = processData as TerminalProcessResponse;
      setTerminalResult(nextResult);
      setMessage(
        nextResult.status === "failed"
          ? "Reader handoff failed. Keep the sale open and retry or cancel from the dashboard."
          : "Sale sent to the stored reader. Wait for Stripe confirmation before treating it as paid."
      );
    } catch (error) {
      if (authEpoch !== authEpochRef.current) return;
      setTerminalResult(null);
      setMessage(error instanceof Error ? error.message : "Could not send sale to reader");
    } finally {
      if (authEpoch === authEpochRef.current) setIsSendingTerminal(false);
    }
  }

  async function endStaffSession() {
    authEpochRef.current += 1;
    reviewVersionRef.current += 1;
    setCart([]);
    setCustomerEmail("");
    setReaderOptions([]);
    setSelectedReaderKey("");
    setReaderMessage(null);
    setAuthorizedStaff(null);
    setDraft(null);
    setTerminalResult(null);
    setMessage(null);
    await staffSession.signOut();
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
                disabled={readerOptions.length === 0}
                onChange={(event) => {
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
              disabled={isLoadingReaders || staffSession.status !== "signed-in"}
              onClick={loadTerminalReaders}
            >
              {isLoadingReaders ? "Loading" : "Load Readers"}
            </button>
          </div>
          {readerMessage ? <p className="posNextTerminalNote">{readerMessage}</p> : null}
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
          <button
            className="primaryAction"
            type="button"
            disabled={isReviewing || cart.length === 0 || staffSession.status !== "signed-in"}
            onClick={reviewSale}
          >
            {isReviewing ? "Reviewing" : "Review Sale"}
            <ArrowRight size={18} />
          </button>
          <button
            className="secondaryAction"
            type="button"
            disabled={
              isReviewing ||
              isSendingTerminal ||
              !terminalAccepted ||
              !draft?.persisted ||
              !draft.saleRef ||
              !draft.draft.readerId ||
              staffSession.status !== "signed-in"
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
