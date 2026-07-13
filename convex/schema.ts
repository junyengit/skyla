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
const catalogVersionStatus = v.union(v.literal("active"), v.literal("inactive"));
const publicGatewayOperation = v.union(
  v.literal("experience-inquiry"),
  v.literal("member-application"),
  v.literal("checkout-draft"),
  v.literal("stripe-checkout")
);

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
    catalogVersion: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    source: v.optional(v.string()),
    authority: v.optional(v.string()),
    updatedBy: v.optional(v.id("staffUsers")),
    updatedAt: v.number()
  })
    .index("by_key", ["key"])
    .index("by_kind_active", ["kind", "active"]),

  catalogVersions: defineTable({
    version: v.string(),
    source: v.string(),
    authority: v.string(),
    status: catalogVersionStatus,
    itemCount: v.number(),
    activeItemCount: v.number(),
    contentHash: v.string(),
    editableInAdmin: v.boolean(),
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
    deactivatedAt: v.optional(v.number()),
    createdBy: v.optional(v.id("staffUsers")),
    activatedBy: v.optional(v.id("staffUsers")),
    deactivatedBy: v.optional(v.id("staffUsers")),
    notes: v.optional(v.string())
  })
    .index("by_version", ["version"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  productSnapshots: defineTable({
    version: v.string(),
    key: v.string(),
    kind: productKind,
    name: v.string(),
    priceCents: v.number(),
    active: v.boolean(),
    category: v.optional(v.string()),
    metadata: v.optional(stringRecord),
    contentHash: v.string(),
    createdAt: v.number()
  })
    .index("by_version", ["version"])
    .index("by_version_key", ["version", "key"])
    .index("by_key_createdAt", ["key", "createdAt"]),

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
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    rawLegacy: v.optional(v.any())
  })
    .index("by_orderRef", ["orderRef"])
    .index("by_channel_idempotencyKey", ["channel", "idempotencyKey"])
    .index("by_createdAt", ["createdAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"])
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
    .index("by_createdAt", ["createdAt"])
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
    providerPaymentIntentId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    status: paymentStatus,
    currency,
    amountCents: v.number(),
    rawEventId: v.optional(v.string()),
    raw: v.optional(v.any()),
    createdAt: v.number()
  })
    .index("by_orderRef", ["orderRef"])
    .index("by_saleRef", ["saleRef"])
    .index("by_createdAt", ["createdAt"])
    .index("by_provider_providerPaymentId", ["provider", "providerPaymentId"])
    .index("by_providerPaymentIntentId", ["providerPaymentIntentId"])
    .index("by_provider_idempotencyKey", ["provider", "idempotencyKey"])
    .index("by_provider_status_createdAt", ["provider", "status", "createdAt"]),

  refunds: defineTable({
    providerRefundId: v.string(),
    providerPaymentIntentId: v.string(),
    paymentProvider: v.union(v.literal("stripe"), v.literal("terminal")),
    orderRef: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("requires_action"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    amountCents: v.number(),
    currency,
    reason: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    providerEventCreatedAt: v.number(),
    rawEventId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_providerRefundId", ["providerRefundId"])
    .index("by_providerPaymentIntentId", ["providerPaymentIntentId"])
    .index("by_orderRef_updatedAt", ["orderRef", "updatedAt"])
    .index("by_saleRef_updatedAt", ["saleRef", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),

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

  publicGatewayRateLimits: defineTable({
    operation: publicGatewayOperation,
    keyHash: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
    windowExpiresAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_operation_keyHash", ["operation", "keyHash"])
    .index("by_windowExpiresAt", ["windowExpiresAt"]),

  bookings: defineTable({
    bookingRef: v.string(),
    orderRef: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    visitDate: v.optional(v.string()),
    entryTime: v.optional(v.string()),
    partySize: v.optional(v.number()),
    status: v.string(),
    emailLower: v.optional(v.string()),
    checkedInAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    legacySource: v.optional(v.string()),
    legacyFingerprint: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_bookingRef", ["bookingRef"])
    .index("by_orderRef", ["orderRef"])
    .index("by_saleRef", ["saleRef"])
    .index("by_visitDate_status", ["visitDate", "status"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"])
    .index("by_legacyId", ["legacyId"])
    .index("by_createdAt", ["createdAt"]),

  ticketDeliveries: defineTable({
    ticketCode: v.string(),
    bookingRef: v.string(),
    orderRef: v.optional(v.string()),
    saleRef: v.optional(v.string()),
    emailLower: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("suppressed")
    ),
    attemptCount: v.number(),
    sendVersion: v.number(),
    providerMessageId: v.optional(v.string()),
    lastAttemptAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index("by_ticketCode", ["ticketCode"])
    .index("by_bookingRef", ["bookingRef"])
    .index("by_orderRef", ["orderRef"])
    .index("by_saleRef", ["saleRef"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  voucherRedemptionEvents: defineTable({
    bookingRef: v.string(),
    voucherId: v.string(),
    delta: v.union(v.literal(1), v.literal(-1)),
    actorStaffUserId: v.id("staffUsers"),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.number()
  })
    .index("by_bookingRef_createdAt", ["bookingRef", "createdAt"])
    .index("by_bookingRef_voucherId_createdAt", ["bookingRef", "voucherId", "createdAt"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  members: defineTable({
    status: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    emailLower: v.optional(v.string()),
    phone: v.optional(v.string()),
    tier: v.optional(v.string()),
    source: v.optional(v.string()),
    bio: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    applicationFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    legacySource: v.optional(v.string()),
    legacyFingerprint: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"])
    .index("by_legacyId", ["legacyId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  inquiries: defineTable({
    status: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    emailLower: v.optional(v.string()),
    experience: v.optional(v.string()),
    eventDate: v.optional(v.string()),
    guestCount: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    inquiryFingerprint: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    legacySource: v.optional(v.string()),
    legacyFingerprint: v.optional(v.string()),
    rawLegacy: v.optional(v.any())
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_emailLower_createdAt", ["emailLower", "createdAt"])
    .index("by_legacyId", ["legacyId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),

  legacyMigrationBatches: defineTable({
    batchId: v.string(),
    source: v.string(),
    kind: v.union(v.literal("bookings"), v.literal("members"), v.literal("inquiries")),
    inputHash: v.string(),
    recordCount: v.number(),
    createdCount: v.number(),
    reusedCount: v.number(),
    completedAt: v.number(),
    rolledBackAt: v.optional(v.number()),
    rollbackDeletedCount: v.optional(v.number()),
    rollbackManualReviewCount: v.optional(v.number())
  })
    .index("by_batchId", ["batchId"])
    .index("by_source_completedAt", ["source", "completedAt"])
    .index("by_completedAt", ["completedAt"]),

  legacyImportRecords: defineTable({
    batchId: v.string(),
    source: v.string(),
    kind: v.union(v.literal("bookings"), v.literal("members"), v.literal("inquiries")),
    legacyId: v.string(),
    targetId: v.string(),
    sourceFingerprint: v.string(),
    targetFingerprint: v.string(),
    operation: v.union(v.literal("created"), v.literal("reused")),
    importedAt: v.number()
  })
    .index("by_batchId", ["batchId"])
    .index("by_source_kind_legacyId", ["source", "kind", "legacyId"])
    .index("by_targetId_importedAt", ["targetId", "importedAt"]),

  legacyMigrationSources: defineTable({
    source: v.string(),
    bookingCount: v.number(),
    memberCount: v.number(),
    inquiryCount: v.number(),
    ledgerRecordCount: v.number(),
    batchCount: v.number(),
    activeBatchCount: v.number(),
    updatedAt: v.number()
  }).index("by_source", ["source"]),

  legacyMigrationTargets: defineTable({
    targetId: v.string(),
    activeBatchCount: v.number(),
    updatedAt: v.number()
  }).index("by_targetId", ["targetId"]),

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
