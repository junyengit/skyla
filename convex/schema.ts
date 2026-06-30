import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const currency = v.literal("usd");
const channel = v.union(v.literal("online"), v.literal("pos"));
const orderStatus = v.union(
  v.literal("draft"),
  v.literal("payment_pending"),
  v.literal("paid"),
  v.literal("canceled"),
  v.literal("expired")
);
const paymentProvider = v.union(v.literal("stripe"), v.literal("kaskade"), v.literal("terminal"));
const paymentStatus = v.union(
  v.literal("created"),
  v.literal("requires_payment"),
  v.literal("processing"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("refunded"),
  v.literal("canceled")
);
const staffRole = v.union(v.literal("admin"), v.literal("pos"), v.literal("viewer"));
const productKind = v.union(v.literal("ticket"), v.literal("addon"), v.literal("cafe"));
const lineKind = v.union(v.literal("ticket"), v.literal("addon"), v.literal("cafe"), v.literal("custom"));

const stringRecord = v.record(v.string(), v.union(v.string(), v.number(), v.boolean()));

export default defineSchema({
  products: defineTable({
    key: v.string(),
    kind: productKind,
    name: v.string(),
    priceCents: v.number(),
    active: v.boolean(),
    category: v.optional(v.string()),
    metadata: v.optional(stringRecord),
    updatedAt: v.number()
  })
    .index("by_key", ["key"])
    .index("by_kind_active", ["kind", "active"]),

  orders: defineTable({
    orderRef: v.string(),
    channel,
    status: orderStatus,
    currency,
    subtotalCents: v.number(),
    feeCents: v.number(),
    totalCents: v.number(),
    expectedProvider: v.optional(paymentProvider),
    customerEmailLower: v.optional(v.string()),
    visitDate: v.optional(v.string()),
    entryTime: v.optional(v.string()),
    source: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    draftFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    rawLegacy: v.optional(v.any())
  })
    .index("by_orderRef", ["orderRef"])
    .index("by_channel_idempotencyKey", ["channel", "idempotencyKey"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_channel_status_createdAt", ["channel", "status", "createdAt"])
    .index("by_customerEmail_createdAt", ["customerEmailLower", "createdAt"]),

  orderLineItems: defineTable({
    orderRef: v.string(),
    kind: lineKind,
    productKey: v.optional(v.string()),
    name: v.string(),
    quantity: v.number(),
    unitAmountCents: v.number(),
    lineTotalCents: v.number(),
    metadata: v.optional(stringRecord)
  })
    .index("by_orderRef", ["orderRef"])
    .index("by_productKey", ["productKey"]),

  posSales: defineTable({
    saleRef: v.string(),
    orderRef: v.optional(v.string()),
    status: orderStatus,
    currency,
    subtotalCents: v.number(),
    feeCents: v.number(),
    totalCents: v.number(),
    staffUserId: v.optional(v.id("staffUsers")),
    customerEmailLower: v.optional(v.string()),
    readerId: v.optional(v.string()),
    terminalLocationId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    draftFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_saleRef", ["saleRef"])
    .index("by_staff_idempotencyKey", ["staffUserId", "idempotencyKey"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_staff_createdAt", ["staffUserId", "createdAt"]),

  posSaleLines: defineTable({
    saleRef: v.string(),
    kind: lineKind,
    productKey: v.optional(v.string()),
    name: v.string(),
    quantity: v.number(),
    unitAmountCents: v.number(),
    lineTotalCents: v.number(),
    metadata: v.optional(stringRecord)
  })
    .index("by_saleRef", ["saleRef"])
    .index("by_productKey", ["productKey"]),

  paymentEvents: defineTable({
    orderRef: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    provider: paymentProvider,
    providerPaymentId: v.string(),
    status: paymentStatus,
    currency,
    amountCents: v.number(),
    rawEventId: v.optional(v.string()),
    raw: v.optional(v.any()),
    createdAt: v.number()
  })
    .index("by_orderRef", ["orderRef"])
    .index("by_saleRef", ["saleRef"])
    .index("by_provider_providerPaymentId", ["provider", "providerPaymentId"])
    .index("by_provider_status_createdAt", ["provider", "status", "createdAt"]),

  webhookEvents: defineTable({
    provider: paymentProvider,
    providerEventId: v.string(),
    eventType: v.string(),
    processedAt: v.number(),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    orderRef: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    raw: v.optional(v.any())
  })
    .index("by_provider_providerEventId", ["provider", "providerEventId"])
    .index("by_provider_status_processedAt", ["provider", "status", "processedAt"]),

  bookings: defineTable({
    bookingRef: v.string(),
    orderRef: v.optional(v.string()),
    visitDate: v.optional(v.string()),
    status: v.string(),
    emailLower: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_bookingRef", ["bookingRef"])
    .index("by_orderRef", ["orderRef"])
    .index("by_visitDate_status", ["visitDate", "status"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  members: defineTable({
    status: v.string(),
    emailLower: v.optional(v.string()),
    tier: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"]),

  inquiries: defineTable({
    status: v.string(),
    emailLower: v.optional(v.string()),
    experience: v.optional(v.string()),
    eventDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"]),

  config: defineTable({
    key: v.string(),
    data: v.any(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("staffUsers"))
  }).index("by_key", ["key"]),

  staffUsers: defineTable({
    subject: v.string(),
    emailLower: v.string(),
    role: staffRole,
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_subject", ["subject"])
    .index("by_emailLower", ["emailLower"])
    .index("by_role_active", ["role", "active"]),

  auditEvents: defineTable({
    actorStaffUserId: v.optional(v.id("staffUsers")),
    action: v.string(),
    entityType: v.string(),
    entityRef: v.string(),
    metadata: v.optional(stringRecord),
    createdAt: v.number()
  })
    .index("by_actor_createdAt", ["actorStaffUserId", "createdAt"])
    .index("by_entity", ["entityType", "entityRef"])
});
