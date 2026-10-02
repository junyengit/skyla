import { makeFunctionReference } from "convex/server";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { buildTicketDeliveryRecord, normalizeTicketCode } from "./ticketDelivery";

export const sendTicketConfirmationAction = makeFunctionReference<
  "action",
  { deliveryId: Id<"ticketDeliveries"> },
  null
>("ticketDelivery:sendTicketConfirmation");

/** Validate delivery invariants before creating a booking or committing its
 * paid capacity. The caller can retain paid evidence as an exception instead
 * of rolling its transaction back on a malformed stored ticket.
 */
export async function assertTicketDeliveryReady(
  ctx: MutationCtx,
  args: { ticketCode?: string; bookingRef: string; orderRef?: string; saleRef?: string; emailLower?: string; now: number }
) {
  const rows = await ctx.db.query("ticketDeliveries")
    .withIndex("by_bookingRef", (q) => q.eq("bookingRef", args.bookingRef)).take(2);
  if (rows.length > 1) throw new Error("Multiple stored ticket deliveries for booking");
  const existing = rows[0];
  if (existing) {
    if (existing.orderRef !== args.orderRef || existing.saleRef !== args.saleRef || existing.emailLower !== args.emailLower) {
      throw new Error("Stored ticket delivery does not match paid booking fulfillment");
    }
    normalizeTicketCode(existing.ticketCode);
  } else {
    if (!args.ticketCode) throw new Error("ticketCode is required for paid ticket fulfillment");
    buildTicketDeliveryRecord({ ...args, ticketCode: args.ticketCode }, args.now);
  }
}

/**
 * One delivery per booking. A repeated paid notification reuses the stored
 * delivery (and its ticket code) instead of creating a second ticket.
 */
export async function ensureTicketDelivery(
  ctx: MutationCtx,
  args: {
    ticketCode?: string;
    bookingRef: string;
    orderRef?: string;
    saleRef?: string;
    emailLower?: string;
    now: number;
  }
) {
  const existing = await ctx.db
    .query("ticketDeliveries")
    .withIndex("by_bookingRef", (q) => q.eq("bookingRef", args.bookingRef))
    .unique();
  if (existing) {
    const mismatch =
      existing.orderRef !== args.orderRef ||
      existing.saleRef !== args.saleRef ||
      existing.emailLower !== args.emailLower;
    if (mismatch) {
      throw new Error("Stored ticket delivery does not match paid booking fulfillment");
    }
    return existing._id;
  }
  if (!args.ticketCode) {
    throw new Error("ticketCode is required for paid ticket fulfillment");
  }
  const delivery = buildTicketDeliveryRecord(args as {
    ticketCode: string;
    bookingRef: string;
    orderRef?: string;
    saleRef?: string;
    emailLower?: string;
  }, args.now);
  const deliveryId = await ctx.db.insert("ticketDeliveries", delivery);
  if (delivery.status === "queued") {
    await ctx.scheduler.runAfter(0, sendTicketConfirmationAction, { deliveryId });
  }
  return deliveryId;
}
