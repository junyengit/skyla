"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ShieldCheck } from "@skyla/ui/icons";

type Readiness = {
  stripeSecret: boolean;
  stripeWebhookSecret: boolean;
  terminalReaderRegistry: boolean;
  paymentReturnOrigins: boolean;
};

type OperationsSnapshot = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  readiness: Readiness;
  counts: {
    draftOrders: { value: number; capped: boolean };
    pendingOrders: { value: number; capped: boolean };
    draftPosSales: { value: number; capped: boolean };
    pendingPosSales: { value: number; capped: boolean };
  };
  recent: {
    orders: Array<{
      orderRef: string;
      status: string;
      totalCents: number;
      currency: "usd";
      expectedProvider?: string;
      customerEmailLower?: string;
      visitDate?: string;
      entryTime?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    posSales: Array<{
      saleRef: string;
      status: string;
      totalCents: number;
      currency: "usd";
      customerEmailLower?: string;
      readerId?: string;
      terminalLocationId?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    paymentEvents: Array<{
      orderRef?: string;
      saleRef?: string;
      provider: string;
      providerPaymentId: string;
      status: string;
      amountCents: number;
      currency: "usd";
      rawEventId?: string;
      createdAt: number;
    }>;
  };
};

type AdminTab = "orders" | "pos" | "payments";

const readinessLabels: Record<keyof Readiness, string> = {
  stripeSecret: "Stripe API",
  stripeWebhookSecret: "Webhook",
  terminalReaderRegistry: "Readers",
  paymentReturnOrigins: "Return URLs"
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function totalReady(readiness: Readiness) {
  return Object.values(readiness).filter(Boolean).length;
}

function countLabel(count?: { value: number; capped: boolean }) {
  if (!count) {
    return "--";
  }
  return count.capped ? `${count.value}+` : String(count.value);
}

export function AdminOpsClient() {
  const [staffToken, setStaffToken] = useState("");
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("orders");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const readinessScore = useMemo(() => (snapshot ? totalReady(snapshot.readiness) : 0), [snapshot]);

  async function loadOperations() {
    const token = staffToken.trim();
    if (!token) {
      setMessage("Staff token required.");
      setSnapshot(null);
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/operations?limit=12", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = (await response.json()) as OperationsSnapshot | { error?: string; code?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error ?? "Could not load admin operations" : "Could not load admin operations");
      }
      setSnapshot(data as OperationsSnapshot);
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "Could not load admin operations");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="adminOpsShell" aria-label="Admin operations">
      <aside className="adminOpsPanel adminOpsAccess">
        <div className="adminOpsPanelHeader">
          <ShieldCheck size={22} />
          <div>
            <p>Access</p>
            <h1>Operations</h1>
          </div>
        </div>
        <label>
          <span>Staff Token</span>
          <input
            autoComplete="off"
            placeholder="Bearer token"
            type="password"
            value={staffToken}
            onChange={(event) => setStaffToken(event.target.value)}
          />
        </label>
        <button className="primaryAction" type="button" disabled={isLoading} onClick={loadOperations}>
          {isLoading ? "Loading" : "Load Snapshot"}
          <ArrowRight size={18} />
        </button>
        {message ? <p className="adminOpsMessage">{message}</p> : null}
        {snapshot ? (
          <div className="adminOpsStaff">
            <span>{snapshot.staff.role}</span>
            <strong>{snapshot.staff.emailLower}</strong>
          </div>
        ) : null}
      </aside>

      <div className="adminOpsMain">
        <div className="adminOpsGrid" aria-label="Operations counters">
          <article>
            <span>Draft Orders</span>
            <strong>{countLabel(snapshot?.counts.draftOrders)}</strong>
          </article>
          <article>
            <span>Pending Orders</span>
            <strong>{countLabel(snapshot?.counts.pendingOrders)}</strong>
          </article>
          <article>
            <span>Draft POS</span>
            <strong>{countLabel(snapshot?.counts.draftPosSales)}</strong>
          </article>
          <article>
            <span>Pending POS</span>
            <strong>{countLabel(snapshot?.counts.pendingPosSales)}</strong>
          </article>
        </div>

        <div className="adminOpsPanel">
          <div className="adminOpsPanelHeader">
            <CalendarDays size={22} />
            <div>
              <p>Readiness</p>
              <h2>{snapshot ? `${readinessScore}/4 configured` : "Waiting"}</h2>
            </div>
          </div>
          <div className="adminOpsReadiness">
            {(Object.entries(readinessLabels) as Array<[keyof Readiness, string]>).map(([key, label]) => (
              <div className={snapshot?.readiness[key] ? "isReady" : ""} key={key}>
                <span>{label}</span>
                <strong>{snapshot ? (snapshot.readiness[key] ? "Ready" : "Missing") : "--"}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="adminOpsPanel">
          <div className="adminOpsTabs" role="tablist" aria-label="Recent operations">
            <button
              className={activeTab === "orders" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "orders"}
              onClick={() => setActiveTab("orders")}
            >
              Orders
            </button>
            <button
              className={activeTab === "pos" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "pos"}
              onClick={() => setActiveTab("pos")}
            >
              POS
            </button>
            <button
              className={activeTab === "payments" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "payments"}
              onClick={() => setActiveTab("payments")}
            >
              Payments
            </button>
          </div>

          <div className="adminOpsTable" role="tabpanel">
            {activeTab === "orders"
              ? snapshot?.recent.orders.map((order) => (
                  <div className="adminOpsRow" key={order.orderRef}>
                    <div>
                      <strong>{order.orderRef}</strong>
                      <span>{[order.visitDate, order.entryTime, order.customerEmailLower].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{order.status}</span>
                    <span>{money(order.totalCents)}</span>
                    <time>{shortDate(order.createdAt)}</time>
                  </div>
                ))
              : null}

            {activeTab === "pos"
              ? snapshot?.recent.posSales.map((sale) => (
                  <div className="adminOpsRow" key={sale.saleRef}>
                    <div>
                      <strong>{sale.saleRef}</strong>
                      <span>{[sale.customerEmailLower, sale.readerId].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{sale.status}</span>
                    <span>{money(sale.totalCents)}</span>
                    <time>{shortDate(sale.createdAt)}</time>
                  </div>
                ))
              : null}

            {activeTab === "payments"
              ? snapshot?.recent.paymentEvents.map((event) => (
                  <div className="adminOpsRow" key={`${event.provider}:${event.providerPaymentId}:${event.createdAt}`}>
                    <div>
                      <strong>{event.providerPaymentId}</strong>
                      <span>{[event.orderRef, event.saleRef, event.rawEventId].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{event.provider}</span>
                    <span>{event.status}</span>
                    <time>{shortDate(event.createdAt)}</time>
                  </div>
                ))
              : null}

            {snapshot && snapshot.recent[activeTab === "orders" ? "orders" : activeTab === "pos" ? "posSales" : "paymentEvents"].length === 0 ? (
              <p className="adminOpsEmpty">No recent records</p>
            ) : null}

            {!snapshot ? <p className="adminOpsEmpty">Snapshot locked</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
