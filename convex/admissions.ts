import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStaffUser } from "./lib/auth";
import { departBooking } from "./lib/admission";
import { loadPhysicalOccupancy } from "./lib/occupancy";

export const getOccupancy = query({
  args: {},
  handler: async ctx => {
    const staff = await requireStaffUser(ctx, ["admin", "pos", "viewer"]);
    const state = await loadPhysicalOccupancy(ctx);
    return {
      staff: { role: staff.role }, insideCount: state.insideCount, capacity: state.capacity,
      remaining: state.unverifiedReason ? 0 : state.remaining, verified: !state.unverifiedReason,
      ...(state.unverifiedReason ? { reason: state.unverifiedReason } : {}),
      parties: state.admissions.map(row => ({ bookingRef: row.bookingRef, partySize: row.partySize,
        departedCount: row.departedCount, admittedAt: row.admittedAt, visitDate: row.visitDate }))
    };
  }
});

export const recordDeparture = mutation({
  args: { bookingRef: v.string(), departedCount: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireStaffUser(ctx, ["admin", "pos"]);
    const booking = await ctx.db.query("bookings").withIndex("by_bookingRef", q => q.eq("bookingRef", args.bookingRef.trim())).unique();
    if (!booking) throw new Error("Booking was not found");
    const result = await departBooking(ctx, booking, staff, args.departedCount, Date.now());
    return { outcome: result.outcome, bookingRef: booking.bookingRef, admittedCount: result.admission.partySize,
      departedCount: result.admission.departedCount, remainingInside: result.admission.partySize - result.admission.departedCount };
  }
});
