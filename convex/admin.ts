import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";

declare const process: { env: Record<string, string | undefined> };

const recentLimit = 12;
const countLimit = 100;

function envConfigured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function publicOrder(order: {
  orderRef: string;
  channel: "online" | "pos";
  status: "draft" | "payment_pending" | "paid" | "canceled" | "expired";
  totalCents: number;
  currency: "usd";
  expectedProvider?: "stripe" | "kaskade" | "terminal";
  customerEmailLower?: string;
  visitDate?: string;
  entryTime?: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    orderRef: order.orderRef,
    channel: order.channel,
    status: order.status,
    totalCents: order.totalCents,
    currency: order.currency,
    expectedProvider: order.expectedProvider,
    customerEmailLower: order.customerEmailLower,
    visitDate: order.visitDate,
    entryTime: order.entryTime,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function publicPosSale(sale: {
  saleRef: string;
  status: "draft" | "payment_pending" | "paid" | "canceled" | "expired";
  totalCents: number;
  currency: "usd";
  customerEmailLower?: string;
  readerId?: string;
  terminalLocationId?: string;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    saleRef: sale.saleRef,
    status: sale.status,
    totalCents: sale.totalCents,
    currency: sale.currency,
    customerEmailLower: sale.customerEmailLower,
    readerId: sale.readerId,
    terminalLocationId: sale.terminalLocationId,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt
  };
}

function publicPaymentEvent(event: {
  orderRef?: string;
  saleRef?: string;
  provider: "stripe" | "kaskade" | "terminal";
  providerPaymentId: string;
  status: "created" | "requires_payment" | "processing" | "paid" | "failed" | "refunded" | "canceled";
  amountCents: number;
  currency: "usd";
  rawEventId?: string;
  createdAt: number;
}) {
  return {
    orderRef: event.orderRef,
    saleRef: event.saleRef,
    provider: event.provider,
    providerPaymentId: event.providerPaymentId,
    status: event.status,
    amountCents: event.amountCents,
    currency: event.currency,
    rawEventId: event.rawEventId,
    createdAt: event.createdAt
  };
}

function cappedCount(items: unknown[]) {
  return {
    value: Math.min(items.length, countLimit),
    capped: items.length > countLimit
  };
}

export const getOperationsSnapshot = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "viewer"]);
    const limit = Math.max(1, Math.min(args.limit ?? recentLimit, 25));

    const [recentOrders, recentPosSales, recentPaymentEvents, draftOrders, pendingOrders, draftPosSales, pendingPosSales] =
      await Promise.all([
        ctx.db.query("orders").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("posSales").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("paymentEvents").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db
          .query("orders")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "draft"))
          .order("desc")
          .take(countLimit + 1),
        ctx.db
          .query("orders")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "payment_pending"))
          .order("desc")
          .take(countLimit + 1),
        ctx.db
          .query("posSales")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "draft"))
          .order("desc")
          .take(countLimit + 1),
        ctx.db
          .query("posSales")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "payment_pending"))
          .order("desc")
          .take(countLimit + 1)
      ]);

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      readiness: {
        stripeSecret: envConfigured("STRIPE_SECRET_KEY"),
        stripeWebhookSecret: envConfigured("STRIPE_WEBHOOK_SECRET"),
        terminalReaderRegistry: envConfigured("SKYLA_TERMINAL_READER_REGISTRY"),
        paymentReturnOrigins: envConfigured("SKYLA_PAYMENT_RETURN_ORIGINS")
      },
      counts: {
        draftOrders: cappedCount(draftOrders),
        pendingOrders: cappedCount(pendingOrders),
        draftPosSales: cappedCount(draftPosSales),
        pendingPosSales: cappedCount(pendingPosSales)
      },
      recent: {
        orders: recentOrders.map(publicOrder),
        posSales: recentPosSales.map(publicPosSale),
        paymentEvents: recentPaymentEvents.map(publicPaymentEvent)
      }
    };
  }
});
