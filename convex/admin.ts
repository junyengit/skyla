import { v } from "convex/values";

import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  configAuditMetadata,
  defaultAnnouncement,
  defaultHours,
  isSiteConfigKey,
  normalizeAnnouncementConfig,
  normalizeHoursConfig,
  normalizeSiteConfig,
  siteConfigKeys
} from "./lib/adminConfig";
import {
  bookingStatusPatch,
  memberStatusPatch,
  normalizeAdminNote,
  statusAuditMetadata
} from "./lib/adminOperations";
import { requireStaffUser } from "./lib/auth";

declare const process: { env: Record<string, string | undefined> };

const recentLimit = 12;
const countLimit = 100;
const bookingAdminStatus = v.union(v.literal("confirmed"), v.literal("checked-in"), v.literal("cancelled"));
const memberAdminStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("waitlisted"),
  v.literal("rejected")
);
const siteConfigKey = v.union(v.literal("announcement"), v.literal("hours"));

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

function publicBooking(booking: {
  bookingRef: string;
  orderRef?: string;
  visitDate?: string;
  status: string;
  emailLower?: string;
  checkedInAt?: number;
  cancelledAt?: number;
  createdAt: number;
  updatedAt?: number;
  legacyId?: string;
}) {
  return {
    bookingRef: booking.bookingRef,
    orderRef: booking.orderRef,
    visitDate: booking.visitDate,
    status: booking.status,
    emailLower: booking.emailLower,
    checkedInAt: booking.checkedInAt,
    cancelledAt: booking.cancelledAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    legacyId: booking.legacyId
  };
}

function publicMember(member: {
  _id: string;
  status: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailLower?: string;
  phone?: string;
  tier?: string;
  source?: string;
  bio?: string;
  createdAt: number;
  updatedAt?: number;
  legacyId?: string;
  rawLegacy?: unknown;
}) {
  const firstName = member.firstName ?? legacyString(member.rawLegacy, "firstName");
  const lastName = member.lastName ?? legacyString(member.rawLegacy, "lastName");
  const email = member.email ?? legacyString(member.rawLegacy, "email") ?? member.emailLower;

  return {
    memberId: member._id,
    firstName,
    lastName,
    email,
    status: member.status,
    emailLower: member.emailLower,
    phone: member.phone ?? legacyString(member.rawLegacy, "phone"),
    tier: member.tier,
    source: member.source ?? legacyString(member.rawLegacy, "source"),
    bio: member.bio ?? legacyString(member.rawLegacy, "bio"),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    legacyId: member.legacyId
  };
}

function legacyString(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return undefined;
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function cappedCount(items: unknown[]) {
  return {
    value: Math.min(items.length, countLimit),
    capped: items.length > countLimit
  };
}

function publicConfigState(row: { updatedAt: number; updatedBy?: string } | null, invalid = false) {
  return row
    ? {
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        invalid
      }
    : {
        updatedAt: undefined,
        updatedBy: undefined,
        invalid
      };
}

function safeAnnouncement(data: unknown) {
  try {
    return { data: normalizeAnnouncementConfig(data), invalid: false };
  } catch {
    return { data: defaultAnnouncement, invalid: true };
  }
}

function safeHours(data: unknown) {
  try {
    return { data: normalizeHoursConfig(data), invalid: false };
  } catch {
    return { data: defaultHours, invalid: true };
  }
}

async function configRow(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export const getOperationsSnapshot = query({
  args: {
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "viewer"]);
    const limit = Math.max(1, Math.min(args.limit ?? recentLimit, 25));

    const [
      recentOrders,
      recentPosSales,
      recentPaymentEvents,
      recentBookings,
      recentMembers,
      draftOrders,
      pendingOrders,
      draftPosSales,
      pendingPosSales,
      pendingMembers,
      approvedMembers
    ] =
      await Promise.all([
        ctx.db.query("orders").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("posSales").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("paymentEvents").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("bookings").withIndex("by_createdAt").order("desc").take(limit),
        ctx.db.query("members").withIndex("by_createdAt").order("desc").take(limit),
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
          .take(countLimit + 1),
        ctx.db
          .query("members")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
          .order("desc")
          .take(countLimit + 1),
        ctx.db
          .query("members")
          .withIndex("by_status_createdAt", (q) => q.eq("status", "approved"))
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
        pendingPosSales: cappedCount(pendingPosSales),
        pendingMembers: cappedCount(pendingMembers),
        approvedMembers: cappedCount(approvedMembers)
      },
      recent: {
        orders: recentOrders.map(publicOrder),
        posSales: recentPosSales.map(publicPosSale),
        paymentEvents: recentPaymentEvents.map(publicPaymentEvent),
        bookings: recentBookings.map(publicBooking),
        members: recentMembers.map(publicMember)
      }
    };
  }
});

export const getConfigSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "viewer"]);
    const [announcementRow, hoursRow] = await Promise.all([
      configRow(ctx, "announcement"),
      configRow(ctx, "hours")
    ]);
    const announcement = safeAnnouncement(announcementRow?.data ?? defaultAnnouncement);
    const hours = safeHours(hoursRow?.data ?? defaultHours);

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      config: {
        announcement: announcement.data,
        hours: hours.data
      },
      state: {
        announcement: publicConfigState(announcementRow, announcement.invalid),
        hours: publicConfigState(hoursRow, hours.invalid)
      },
      editableKeys: staffUser.role === "admin" ? [...siteConfigKeys] : []
    };
  }
});

export const updateSiteConfig = mutation({
  args: {
    key: siteConfigKey,
    data: v.any(),
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    if (!isSiteConfigKey(args.key)) {
      throw new Error("config key is not recognized");
    }

    const normalized = normalizeSiteConfig(args.key, args.data);
    const now = Date.now();
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        data: normalized,
        updatedAt: now,
        updatedBy: staffUser._id
      });
    } else {
      await ctx.db.insert("config", {
        key: args.key,
        data: normalized,
        updatedAt: now,
        updatedBy: staffUser._id
      });
    }

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "admin.config.update",
      entityType: "config",
      entityRef: args.key,
      metadata: configAuditMetadata(args.key, args.note),
      createdAt: now
    });

    return {
      key: args.key,
      data: normalized,
      updatedAt: now
    };
  }
});

export const updateBookingStatus = mutation({
  args: {
    bookingRef: v.string(),
    status: bookingAdminStatus,
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, args.status === "cancelled" ? ["admin"] : ["admin", "pos"]);
    const bookingRef = args.bookingRef.trim();
    if (!bookingRef) {
      throw new Error("bookingRef is required");
    }

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", bookingRef))
      .unique();
    if (!booking) {
      throw new Error("Booking was not found");
    }
    if (booking.status === args.status) {
      return publicBooking(booking);
    }
    if (booking.status === "cancelled" && args.status === "checked-in") {
      throw new Error("Cancelled bookings cannot be checked in");
    }
    if (booking.status === "cancelled" && args.status !== "cancelled" && staffUser.role !== "admin") {
      throw new Error("Only admin staff can restore cancelled bookings");
    }

    const note = normalizeAdminNote(args.note);
    const now = Date.now();
    const patch = bookingStatusPatch(args.status, now);

    await ctx.db.patch(booking._id, patch);
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "admin.bookingStatus.update",
      entityType: "booking",
      entityRef: booking.bookingRef,
      metadata: statusAuditMetadata(booking.status, args.status, note),
      createdAt: now
    });

    return publicBooking({ ...booking, ...patch });
  }
});

export const updateMemberStatus = mutation({
  args: {
    memberId: v.id("members"),
    status: memberAdminStatus,
    note: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    const member = await ctx.db.get(args.memberId);
    if (!member) {
      throw new Error("Member application was not found");
    }

    const note = normalizeAdminNote(args.note);
    const now = Date.now();
    const patch = memberStatusPatch(args.status, now);

    await ctx.db.patch(member._id, patch);
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "admin.memberStatus.update",
      entityType: "member",
      entityRef: member._id,
      metadata: statusAuditMetadata(member.status, args.status, note),
      createdAt: now
    });

    return publicMember({ ...member, ...patch });
  }
});
