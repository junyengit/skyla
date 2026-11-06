import { admissionMaxPartySize, parseVisitDate } from "@skyla/payments";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { loadDateOccupancy, loadVenueHours, projectPublicVisitAvailability } from "./lib/capacity";

/**
 * Read-only, anonymous aggregate availability for one LA date and party size.
 * Returns slot states and remaining place counts only: never order or booking
 * refs, customer emails, ticket codes, or private-event labels. Safe to serve
 * while ticket sales stay switched off; purchases still go through the
 * locked public gateway and re-check capacity server-side.
 */
export const getPublicVisitAvailability = query({
  args: {
    visitDate: v.string(),
    partySize: v.number()
  },
  handler: async (ctx, args) => {
    const visitDate = parseVisitDate(args.visitDate);
    if (!visitDate) {
      throw new Error("visitDate must be a real YYYY-MM-DD date");
    }
    if (!Number.isSafeInteger(args.partySize) || args.partySize < 1 || args.partySize > admissionMaxPartySize) {
      throw new Error(`partySize must be a whole number from 1 to ${admissionMaxPartySize}`);
    }

    const hours = await loadVenueHours(ctx);
    const occupancy = await loadDateOccupancy(ctx, visitDate, hours);
    return projectPublicVisitAvailability({
      visitDate,
      partySize: args.partySize,
      hours,
      occupancy,
      now: Date.now()
    });
  }
});
