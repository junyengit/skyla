import { projectVoucherRedemption } from "@skyla/payments";
import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
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
  statusAuditMetadata,
  voucherAuditMetadata
} from "./lib/adminOperations";
import { buildAdminBookingVouchers, type AdminBookingVouchers } from "./lib/adminVouchers";
import { requireStaffUser } from "./lib/auth";
import { listTerminalReaderRegistry } from "./lib/terminalReaderRegistry";

declare const process: { env: Record<string, string | undefined> };

const recentLimit = 12;
const countLimit = 100;
const adminExportLimit = 250;
const bookingAdminStatus = v.union(v.literal("confirmed"), v.literal("checked-in"), v.literal("cancelled"));
const bookingVoucherAction = v.union(v.literal("redeem"), v.literal("undo"));
const memberAdminStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("waitlisted"),
  v.literal("rejected")
);
const adminExportKind = v.union(
  v.literal("bookings"),
  v.literal("members"),
  v.literal("inquiries"),
  v.literal("orders"),
  v.literal("posSales"),
  v.literal("payments")
);
const siteConfigKey = v.union(v.literal("announcement"), v.literal("hours"));

function envConfigured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function stripeMode() {
  const mode = process.env.SKYLA_STRIPE_MODE?.trim();
  if (mode === "test" || mode === "live") {
    return mode;
  }
  return mode ? "invalid" : "unset";
}

function terminalReaderRegistryState() {
  try {
    const readers = listTerminalReaderRegistry(process.env.SKYLA_TERMINAL_READER_REGISTRY);
    return {
      configured: true,
      valid: true,
      readerCount: readers.length
    };
  } catch (error) {
    return {
      configured: envConfigured("SKYLA_TERMINAL_READER_REGISTRY"),
      valid: false,
      readerCount: 0,
      error: error instanceof Error ? error.message : "Terminal reader registry is invalid"
    };
  }
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
  entryTime?: string;
  status: string;
  emailLower?: string;
  firstName?: string;
  lastName?: string;
  partySize?: number;
  checkedInAt?: number;
  cancelledAt?: number;
  createdAt: number;
  updatedAt?: number;
  legacyId?: string;
  rawLegacy?: unknown;
}, vouchers?: AdminBookingVouchers) {
  const firstName = booking.firstName ?? legacyString(booking.rawLegacy, "firstName");
  const lastName = booking.lastName ?? legacyString(booking.rawLegacy, "lastName");
  const partySize = booking.partySize ?? legacyNumber(booking.rawLegacy, "partySize") ?? legacyNumber(booking.rawLegacy, "guests");

  return {
    bookingRef: booking.bookingRef,
    orderRef: booking.orderRef,
    visitDate: booking.visitDate,
    entryTime: booking.entryTime,
    status: booking.status,
    emailLower: booking.emailLower,
    firstName,
    lastName,
    partySize,
    checkedInAt: booking.checkedInAt,
    cancelledAt: booking.cancelledAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    legacyId: booking.legacyId,
    ...(vouchers ? { vouchers } : {})
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

function publicInquiry(inquiry: {
  _id: string;
  status: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailLower?: string;
  experience?: string;
  eventDate?: string;
  guestCount?: string;
  notes?: string;
  source?: string;
  createdAt: number;
  updatedAt?: number;
  legacyId?: string;
  rawLegacy?: unknown;
}) {
  const firstName = inquiry.firstName ?? legacyString(inquiry.rawLegacy, "firstName");
  const lastName = inquiry.lastName ?? legacyString(inquiry.rawLegacy, "lastName");
  const email = inquiry.email ?? legacyString(inquiry.rawLegacy, "email") ?? inquiry.emailLower;

  return {
    inquiryId: inquiry._id,
    firstName,
    lastName,
    email,
    status: inquiry.status,
    emailLower: inquiry.emailLower,
    experience: inquiry.experience ?? legacyString(inquiry.rawLegacy, "experience"),
    eventDate: inquiry.eventDate ?? legacyString(inquiry.rawLegacy, "eventDate"),
    guestCount: inquiry.guestCount ?? legacyString(inquiry.rawLegacy, "guestCount"),
    notes: inquiry.notes ?? legacyString(inquiry.rawLegacy, "notes"),
    source: inquiry.source ?? legacyString(inquiry.rawLegacy, "source"),
    createdAt: inquiry.createdAt,
    updatedAt: inquiry.updatedAt,
    legacyId: inquiry.legacyId
  };
}

function legacyString(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return undefined;
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function legacyNumber(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return undefined;
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function cappedCount(items: unknown[]) {
  return {
    value: Math.min(items.length, countLimit),
    capped: items.length > countLimit
  };
}

function boundedAdminExportLimit(value: number | undefined) {
  const limit = value ?? adminExportLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > adminExportLimit) {
    throw new Error(`limit must be an integer between 1 and ${adminExportLimit}`);
  }
  return limit;
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

async function orderLinesForBooking(ctx: QueryCtx | MutationCtx, booking: { orderRef?: string }) {
  const orderRef = booking.orderRef;
  if (!orderRef) {
    return [];
  }
  return await ctx.db
    .query("orderLineItems")
    .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
    .take(100);
}

async function voucherEventsForBooking(ctx: QueryCtx | MutationCtx, bookingRef: string) {
  return await ctx.db
    .query("voucherRedemptionEvents")
    .withIndex("by_bookingRef_createdAt", (q) => q.eq("bookingRef", bookingRef))
    .order("asc")
    .take(500);
}

async function bookingVoucherState(
  ctx: QueryCtx | MutationCtx,
  booking: {
    bookingRef: string;
    orderRef?: string;
    partySize?: number;
    rawLegacy?: unknown;
  }
) {
  const [orderLines, events] = await Promise.all([
    orderLinesForBooking(ctx, booking),
    voucherEventsForBooking(ctx, booking.bookingRef)
  ]);

  return buildAdminBookingVouchers(booking, orderLines, events);
}

async function publicBookingWithVouchers(
  ctx: QueryCtx | MutationCtx,
  booking: Parameters<typeof publicBooking>[0]
) {
  return publicBooking(booking, await bookingVoucherState(ctx, booking));
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

    const publicRecentBookings = await Promise.all(recentBookings.map((booking) => publicBookingWithVouchers(ctx, booking)));

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      readiness: {
        stripeMode: envConfigured("SKYLA_STRIPE_MODE"),
        stripeSecret: envConfigured("STRIPE_SECRET_KEY"),
        stripeWebhookSecret: envConfigured("STRIPE_WEBHOOK_SECRET"),
        terminalReaderRegistry: envConfigured("SKYLA_TERMINAL_READER_REGISTRY"),
        terminalAcceptance: process.env.SKYLA_POS_TERMINAL_ACCEPTANCE === "enabled",
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
        bookings: publicRecentBookings,
        members: recentMembers.map(publicMember)
      }
    };
  }
});

export const getAdminExportRows = query({
  args: {
    kind: adminExportKind,
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    const limit = boundedAdminExportLimit(args.limit);
    const staff = {
      emailLower: staffUser.emailLower,
      role: staffUser.role
    };
    const generatedAt = Date.now();

    switch (args.kind) {
      case "bookings": {
        const bookings = await ctx.db.query("bookings").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: await Promise.all(bookings.map((booking) => publicBookingWithVouchers(ctx, booking)))
        };
      }
      case "members": {
        const members = await ctx.db.query("members").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: members.map(publicMember)
        };
      }
      case "inquiries": {
        const inquiries = await ctx.db.query("inquiries").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: inquiries.map(publicInquiry)
        };
      }
      case "orders": {
        const orders = await ctx.db.query("orders").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: orders.map(publicOrder)
        };
      }
      case "posSales": {
        const sales = await ctx.db.query("posSales").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: sales.map(publicPosSale)
        };
      }
      case "payments": {
        const events = await ctx.db.query("paymentEvents").withIndex("by_createdAt").order("desc").take(limit);
        return {
          staff,
          kind: args.kind,
          generatedAt,
          limit,
          rows: events.map(publicPaymentEvent)
        };
      }
    }
  }
});

export const getAcceptanceReadiness = query({
  args: {},
  handler: async (ctx) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const mode = stripeMode();
    const registry = terminalReaderRegistryState();
    const stripeSecretConfigured = envConfigured("STRIPE_SECRET_KEY");
    const paymentReturnOriginsConfigured = envConfigured("SKYLA_PAYMENT_RETURN_ORIGINS");
    const stripeWebhookSecretConfigured = envConfigured("STRIPE_WEBHOOK_SECRET");
    const terminalAcceptanceEnabled = process.env.SKYLA_POS_TERMINAL_ACCEPTANCE === "enabled";

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      stripe: {
        mode,
        secretConfigured: stripeSecretConfigured,
        paymentReturnOriginsConfigured,
        webhookSecretConfigured: stripeWebhookSecretConfigured,
        checkoutReady:
          mode === "test" &&
          stripeSecretConfigured &&
          paymentReturnOriginsConfigured &&
          stripeWebhookSecretConfigured
      },
      terminal: {
        readerRegistryConfigured: registry.configured,
        readerRegistryValid: registry.valid,
        readerCount: registry.readerCount,
        readerRegistryError: registry.error,
        acceptanceEnabled: terminalAcceptanceEnabled,
        readerProcessingReady:
          mode === "test" &&
          stripeSecretConfigured &&
          stripeWebhookSecretConfigured &&
          registry.valid &&
          registry.readerCount > 0 &&
          terminalAcceptanceEnabled
      }
    };
  }
});

export const listTerminalReaders = query({
  args: {},
  handler: async (ctx) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const readers = listTerminalReaderRegistry(process.env.SKYLA_TERMINAL_READER_REGISTRY);

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      readers: readers.map((reader, index) => ({
        ...reader,
        label: `Reader ${index + 1}`
      }))
    };
  }
});

export const lookupBookingForCheckIn = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos", "viewer"]);
    const queryText = args.query.trim();
    if (!queryText) {
      throw new Error("query is required");
    }
    if (queryText.length > 120) {
      throw new Error("query must be 120 characters or fewer");
    }
    const limit = Math.max(1, Math.min(args.limit ?? 6, 8));
    const normalizedRef = queryText.toUpperCase();

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", normalizedRef))
      .unique();
    if (booking) {
      return {
        staff: {
          emailLower: staffUser.emailLower,
          role: staffUser.role
        },
        query: queryText,
        matchType: "bookingRef" as const,
        matches: [await publicBookingWithVouchers(ctx, booking)]
      };
    }

    if (queryText.includes("@")) {
      const matches = await ctx.db
        .query("bookings")
        .withIndex("by_emailLower_createdAt", (q) => q.eq("emailLower", queryText.toLowerCase()))
        .order("desc")
        .take(limit);

      return {
        staff: {
          emailLower: staffUser.emailLower,
          role: staffUser.role
        },
        query: queryText,
        matchType: "email" as const,
        matches: await Promise.all(matches.map((match) => publicBookingWithVouchers(ctx, match)))
      };
    }

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      query: queryText,
      matchType: "bookingRef" as const,
      matches: []
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

export const updateBookingVoucherRedemption = mutation({
  args: {
    bookingRef: v.string(),
    voucherId: v.string(),
    action: bookingVoucherAction,
    note: v.optional(v.string()),
    idempotencyKey: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "pos"]);
    const bookingRef = args.bookingRef.trim();
    const voucherId = args.voucherId.trim();
    if (!bookingRef) {
      throw new Error("bookingRef is required");
    }
    if (!voucherId) {
      throw new Error("voucherId is required");
    }
    if (voucherId.length > 80) {
      throw new Error("voucherId must be 80 characters or fewer");
    }

    const idempotencyKey = args.idempotencyKey?.trim();
    if (idempotencyKey && idempotencyKey.length > 120) {
      throw new Error("idempotencyKey must be 120 characters or fewer");
    }
    const delta = args.action === "redeem" ? 1 : -1;

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", bookingRef))
      .unique();
    if (!booking) {
      throw new Error("Booking was not found");
    }
    if (booking.status === "cancelled") {
      throw new Error("Cancelled bookings cannot redeem vouchers");
    }

    const orderRef = booking.orderRef;
    if (orderRef) {
      const linkedOrder = await ctx.db
        .query("orders")
        .withIndex("by_orderRef", (q) => q.eq("orderRef", orderRef))
        .unique();
      if (!linkedOrder) {
        throw new Error("Linked order was not found for voucher redemption");
      }
      if (linkedOrder.status !== "paid") {
        throw new Error("Linked order must be paid before vouchers can be redeemed");
      }
    }

    if (idempotencyKey) {
      const existingEvent = await ctx.db
        .query("voucherRedemptionEvents")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existingEvent) {
        if (existingEvent.bookingRef !== bookingRef || existingEvent.voucherId !== voucherId || existingEvent.delta !== delta) {
          throw new Error("Voucher redemption idempotency key was reused for a different action");
        }
        return await publicBookingWithVouchers(ctx, booking);
      }
    }

    const note = normalizeAdminNote(args.note);
    const vouchers = await bookingVoucherState(ctx, booking);
    const projection = projectVoucherRedemption(vouchers.items, voucherId, delta);
    const now = Date.now();

    await ctx.db.insert("voucherRedemptionEvents", {
      bookingRef,
      voucherId,
      delta,
      actorStaffUserId: staffUser._id,
      idempotencyKey: idempotencyKey || undefined,
      createdAt: now
    });
    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: args.action === "redeem" ? "admin.bookingVoucher.redeem" : "admin.bookingVoucher.undo",
      entityType: "booking",
      entityRef: booking.bookingRef,
      metadata: voucherAuditMetadata(args.action, projection, note),
      createdAt: now
    });

    return await publicBookingWithVouchers(ctx, booking);
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
