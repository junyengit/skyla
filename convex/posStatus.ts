import { v } from "convex/values";

import { query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";

export const getPosSaleStatus = query({
  args: { saleRef: v.string() },
  handler: async (ctx, args) => {
    await requireStaffUser(ctx, ["admin", "pos"]);
    const saleRef = args.saleRef.trim();
    if (!saleRef || saleRef.length > 80) throw new Error("saleRef is invalid");
    const sale = await ctx.db
      .query("posSales")
      .withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef))
      .unique();
    if (!sale) throw new Error("POS sale was not found");
    const [lines, paymentEvents, booking, delivery] = await Promise.all([
      ctx.db.query("posSaleLines").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).collect(),
      ctx.db.query("paymentEvents").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).collect(),
      ctx.db.query("bookings").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).unique(),
      ctx.db.query("ticketDeliveries").withIndex("by_saleRef", (q) => q.eq("saleRef", saleRef)).unique()
    ]);
    const latestPayment = paymentEvents.toSorted((a, b) => b.createdAt - a.createdAt)[0];
    return {
      saleRef,
      status: sale.status,
      currency: sale.currency,
      subtotalCents: sale.subtotalCents,
      feeCents: sale.feeCents,
      totalCents: sale.totalCents,
      paymentStatus: latestPayment?.status,
      lines: lines.map((line) => ({
        kind: line.kind,
        name: line.name,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineTotalCents: line.lineTotalCents
      })),
      bookingRef: booking?.bookingRef,
      ticketCode: delivery?.ticketCode,
      updatedAt: sale.updatedAt
    };
  }
});
