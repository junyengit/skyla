import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  assertLegacyMigrationAuthorized,
  normalizeLegacyBatchIdentity,
  normalizeLegacyBooking,
  normalizeLegacyInquiry,
  normalizeLegacyMember,
  normalizeLegacySource,
  stableMigrationHash,
  type LegacyMigrationInput,
  type LegacyMigrationKind
} from "./lib/legacyMigration";

declare const process: { env: Record<string, string | undefined> };

const kindValidator = v.union(v.literal("bookings"), v.literal("members"), v.literal("inquiries"));
const recordValidator = v.object({
  legacyId: v.string(),
  createdAt: v.number(),
  raw: v.any()
});

export const upsertLegacyBatch = mutation({
  args: {
    migrationToken: v.string(),
    source: v.string(),
    batchId: v.string(),
    kind: kindValidator,
    records: v.array(recordValidator)
  },
  handler: async (ctx, args) => {
    assertLegacyMigrationAuthorized(args.migrationToken, process.env.SKYLA_DATA_MIGRATION_TOKEN);
    const batch = await normalizeLegacyBatchIdentity(args);
    const existingBatch = await ctx.db
      .query("legacyMigrationBatches")
      .withIndex("by_batchId", (q) => q.eq("batchId", batch.batchId))
      .unique();
    if (existingBatch) {
      if (
        existingBatch.source !== batch.source ||
        existingBatch.kind !== batch.kind ||
        existingBatch.inputHash !== batch.inputHash
      ) {
        throw new Error("batchId was already used for different legacy migration input");
      }
      if (existingBatch.rolledBackAt) {
        throw new Error("batchId belongs to a rolled-back migration; use a new batchId to import again");
      }
      return batchResult(existingBatch, true);
    }

    let createdCount = 0;
    let reusedCount = 0;
    for (const record of batch.records) {
      const outcome = await upsertRecord(ctx, batch.kind, record, batch.source);
      if (outcome.operation === "created") createdCount += 1;
      if (outcome.operation === "reused") reusedCount += 1;
      await ctx.db.insert("legacyImportRecords", {
        batchId: batch.batchId,
        source: batch.source,
        kind: batch.kind,
        legacyId: record.legacyId,
        targetId: outcome.targetId,
        sourceFingerprint: await stableMigrationHash(record),
        targetFingerprint: outcome.targetFingerprint,
        operation: outcome.operation,
        importedAt: outcome.importedAt
      });
      await updateTargetReferenceCount(ctx, outcome.targetId, 1, outcome.importedAt);
    }

    const completedAt = Date.now();
    const batchDocument = {
      batchId: batch.batchId,
      source: batch.source,
      kind: batch.kind,
      inputHash: batch.inputHash,
      recordCount: batch.records.length,
      createdCount,
      reusedCount,
      completedAt
    };
    await ctx.db.insert("legacyMigrationBatches", batchDocument);
    await updateSourceSummaryAfterBatch(ctx, batch.source, batch.kind, createdCount, batch.records.length, completedAt);
    await ctx.db.insert("auditEvents", {
      action: "legacyMigration.batch.upsert",
      entityType: "legacyMigrationBatch",
      entityRef: batch.batchId,
      metadata: {
        source: batch.source,
        kind: batch.kind,
        inputHash: batch.inputHash,
        recordCount: batch.records.length,
        createdCount,
        reusedCount
      },
      createdAt: completedAt
    });
    return batchResult(batchDocument, false);
  }
});

export const getLegacyMigrationSummary = query({
  args: {
    migrationToken: v.string(),
    source: v.string()
  },
  handler: async (ctx, args) => {
    assertLegacyMigrationAuthorized(args.migrationToken, process.env.SKYLA_DATA_MIGRATION_TOKEN);
    const source = normalizeLegacySource(args.source);
    const sourceSummary = await ctx.db
      .query("legacyMigrationSources")
      .withIndex("by_source", (q) => q.eq("source", source))
      .unique();
    const batches = await ctx.db
      .query("legacyMigrationBatches")
      .withIndex("by_source_completedAt", (q) => q.eq("source", source))
      .order("desc")
      .take(100);
    const counts = {
      bookings: sourceSummary?.bookingCount ?? 0,
      members: sourceSummary?.memberCount ?? 0,
      inquiries: sourceSummary?.inquiryCount ?? 0
    };
    return {
      source,
      counts,
      uniqueRecordCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
      ledgerRecordCount: sourceSummary?.ledgerRecordCount ?? 0,
      batchCount: sourceSummary?.batchCount ?? 0,
      activeBatchCount: sourceSummary?.activeBatchCount ?? 0,
      recentBatches: batches.map((batch) => ({
        batchId: batch.batchId,
        kind: batch.kind,
        inputHash: batch.inputHash,
        recordCount: batch.recordCount,
        createdCount: batch.createdCount,
        reusedCount: batch.reusedCount,
        completedAt: batch.completedAt,
        rolledBackAt: batch.rolledBackAt,
        rollbackDeletedCount: batch.rollbackDeletedCount,
        rollbackManualReviewCount: batch.rollbackManualReviewCount
      }))
    };
  }
});

export const verifyLegacyMigrationBatches = query({
  args: {
    migrationToken: v.string(),
    source: v.string(),
    expected: v.array(v.object({ batchId: v.string(), inputHash: v.string() }))
  },
  handler: async (ctx, args) => {
    assertLegacyMigrationAuthorized(args.migrationToken, process.env.SKYLA_DATA_MIGRATION_TOKEN);
    const source = normalizeLegacySource(args.source);
    if (args.expected.length < 1 || args.expected.length > 50) {
      throw new Error("batch verification requires 1-50 expected batches");
    }
    const results = [];
    for (const expected of args.expected) {
      const batch = await ctx.db
        .query("legacyMigrationBatches")
        .withIndex("by_batchId", (q) => q.eq("batchId", expected.batchId))
        .unique();
      results.push({
        batchId: expected.batchId,
        verified: Boolean(
          batch && batch.source === source && batch.inputHash === expected.inputHash && !batch.rolledBackAt
        )
      });
    }
    return { source, results };
  }
});

export const rollbackLegacyBatch = mutation({
  args: {
    migrationToken: v.string(),
    batchId: v.string()
  },
  handler: async (ctx, args) => {
    assertLegacyMigrationAuthorized(args.migrationToken, process.env.SKYLA_DATA_MIGRATION_TOKEN);
    const batchId = args.batchId.trim();
    if (!/^[A-Za-z0-9:_.-]{1,160}$/.test(batchId)) {
      throw new Error("batchId must use URL-safe characters");
    }
    const batch = await ctx.db
      .query("legacyMigrationBatches")
      .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
      .unique();
    if (!batch) throw new Error("legacy migration batch was not found");
    if (batch.rolledBackAt) {
      return {
        batchId,
        deletedCount: batch.rollbackDeletedCount ?? 0,
        manualReviewCount: batch.rollbackManualReviewCount ?? 0,
        rolledBackAt: batch.rolledBackAt,
        reusedRollback: true
      };
    }

    const ledger = await ctx.db
      .query("legacyImportRecords")
      .withIndex("by_batchId", (q) => q.eq("batchId", batchId))
      .collect();
    if (ledger.length !== batch.recordCount) {
      throw new Error("legacy migration ledger count does not match its batch");
    }

    const deletions: Array<{ table: LegacyMigrationKind; id: string }> = [];
    let manualReviewCount = 0;
    for (const entry of ledger) {
      if (entry.operation !== "created") {
        manualReviewCount += 1;
        continue;
      }
      const targetSummary = await ctx.db
        .query("legacyMigrationTargets")
        .withIndex("by_targetId", (q) => q.eq("targetId", entry.targetId))
        .unique();
      if (!targetSummary || targetSummary.activeBatchCount !== 1) {
        throw new Error(`rollback conflict: a later active batch references ${entry.legacyId}`);
      }
      const current = await findLegacyRecord(ctx, entry.kind, entry.legacyId);
      if (!current) throw new Error(`rollback conflict: created legacy record ${entry.legacyId} is missing`);
      if (current._id !== entry.targetId) {
        throw new Error(`rollback conflict: legacy record ${entry.legacyId} target identity changed`);
      }
      const { _id, _creationTime: _ignoredCreationTime, ...currentData } = current;
      if (await stableMigrationHash(currentData) !== entry.targetFingerprint) {
        throw new Error(`rollback conflict: legacy record ${entry.legacyId} changed after import`);
      }
      if (entry.kind === "bookings") {
        const bookingRef = (current as { bookingRef: string }).bookingRef;
        const voucherEvent = await ctx.db
          .query("voucherRedemptionEvents")
          .withIndex("by_bookingRef_createdAt", (q) => q.eq("bookingRef", bookingRef))
          .first();
        if (voucherEvent) {
          throw new Error(`rollback conflict: legacy booking ${entry.legacyId} has voucher history`);
        }
      }
      deletions.push({ table: entry.kind, id: _id });
    }

    for (const deletion of deletions) {
      await ctx.db.delete(deletion.id as never);
    }
    for (const entry of ledger) {
      await updateTargetReferenceCount(ctx, entry.targetId, -1, Date.now());
    }
    const rolledBackAt = Date.now();
    await ctx.db.patch(batch._id, {
      rolledBackAt,
      rollbackDeletedCount: deletions.length,
      rollbackManualReviewCount: manualReviewCount
    });
    await updateSourceSummaryAfterRollback(ctx, batch.source, batch.kind, deletions.length, rolledBackAt);
    await ctx.db.insert("auditEvents", {
      action: "legacyMigration.batch.rollback",
      entityType: "legacyMigrationBatch",
      entityRef: batchId,
      metadata: {
        source: batch.source,
        kind: batch.kind,
        deletedCount: deletions.length,
        manualReviewCount
      },
      createdAt: rolledBackAt
    });
    return { batchId, deletedCount: deletions.length, manualReviewCount, rolledBackAt, reusedRollback: false };
  }
});

async function upsertRecord(
  ctx: MutationCtx,
  kind: LegacyMigrationKind,
  record: LegacyMigrationInput,
  source: string
): Promise<{
  operation: "created" | "reused";
  targetId: string;
  targetFingerprint: string;
  importedAt: number;
}> {
  if (kind === "bookings") {
    const normalized = await normalizeLegacyBooking(record, source);
    const bookingRefConflict = await ctx.db
      .query("bookings")
      .withIndex("by_bookingRef", (q) => q.eq("bookingRef", normalized.bookingRef))
      .first();
    if (bookingRefConflict && bookingRefConflict.legacyId !== normalized.legacyId) {
      throw new Error(`legacy booking reference conflicts with an existing booking: ${normalized.bookingRef}`);
    }
    return upsertTableRecord(ctx, "bookings", normalized);
  }
  if (kind === "members") {
    return upsertTableRecord(ctx, "members", await normalizeLegacyMember(record, source));
  }
  return upsertTableRecord(ctx, "inquiries", await normalizeLegacyInquiry(record, source));
}

async function upsertTableRecord(
  ctx: MutationCtx,
  table: "bookings" | "members" | "inquiries",
  record: { legacyId: string; legacyFingerprint: string } & Record<string, unknown>
) {
  const targetFingerprint = await stableMigrationHash(record);
  const importedAt = Date.now();
  const existing = await ctx.db
    .query(table)
    .withIndex("by_legacyId", (q) => q.eq("legacyId", record.legacyId))
    .unique();
  if (!existing) {
    const targetId = await ctx.db.insert(table, record as never);
    return { operation: "created" as const, targetId, targetFingerprint, importedAt };
  }
  if (existing.legacyFingerprint === record.legacyFingerprint) {
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...existingData } = existing;
    return {
      operation: "reused" as const,
      targetId: existing._id,
      targetFingerprint: await stableMigrationHash(existingData),
      importedAt
    };
  }
  throw new Error(`legacy record ${record.legacyId} differs from its existing target; resolve it manually`);
}

async function updateSourceSummaryAfterBatch(
  ctx: MutationCtx,
  source: string,
  kind: LegacyMigrationKind,
  createdCount: number,
  ledgerRecordCount: number,
  updatedAt: number
) {
  const existing = await ctx.db
    .query("legacyMigrationSources")
    .withIndex("by_source", (q) => q.eq("source", source))
    .unique();
  const countField = sourceCountField(kind);
  if (!existing) {
    await ctx.db.insert("legacyMigrationSources", {
      source,
      bookingCount: kind === "bookings" ? createdCount : 0,
      memberCount: kind === "members" ? createdCount : 0,
      inquiryCount: kind === "inquiries" ? createdCount : 0,
      ledgerRecordCount,
      batchCount: 1,
      activeBatchCount: 1,
      updatedAt
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    [countField]: existing[countField] + createdCount,
    ledgerRecordCount: existing.ledgerRecordCount + ledgerRecordCount,
    batchCount: existing.batchCount + 1,
    activeBatchCount: existing.activeBatchCount + 1,
    updatedAt
  });
}

async function updateSourceSummaryAfterRollback(
  ctx: MutationCtx,
  source: string,
  kind: LegacyMigrationKind,
  deletedCount: number,
  updatedAt: number
) {
  const existing = await ctx.db
    .query("legacyMigrationSources")
    .withIndex("by_source", (q) => q.eq("source", source))
    .unique();
  if (!existing) throw new Error("legacy migration source summary is missing");
  const countField = sourceCountField(kind);
  if (existing[countField] < deletedCount || existing.activeBatchCount < 1) {
    throw new Error("legacy migration source summary is inconsistent");
  }
  await ctx.db.patch(existing._id, {
    [countField]: existing[countField] - deletedCount,
    activeBatchCount: existing.activeBatchCount - 1,
    updatedAt
  });
}

function sourceCountField(kind: LegacyMigrationKind): "bookingCount" | "memberCount" | "inquiryCount" {
  if (kind === "bookings") return "bookingCount";
  if (kind === "members") return "memberCount";
  return "inquiryCount";
}

async function updateTargetReferenceCount(ctx: MutationCtx, targetId: string, delta: 1 | -1, updatedAt: number) {
  const existing = await ctx.db
    .query("legacyMigrationTargets")
    .withIndex("by_targetId", (q) => q.eq("targetId", targetId))
    .unique();
  if (!existing) {
    if (delta < 0) throw new Error("legacy migration target summary is missing");
    await ctx.db.insert("legacyMigrationTargets", { targetId, activeBatchCount: 1, updatedAt });
    return;
  }
  const activeBatchCount = existing.activeBatchCount + delta;
  if (activeBatchCount < 0) throw new Error("legacy migration target summary is inconsistent");
  await ctx.db.patch(existing._id, { activeBatchCount, updatedAt });
}

async function findLegacyRecord(ctx: MutationCtx, kind: LegacyMigrationKind, legacyId: string) {
  return ctx.db.query(kind).withIndex("by_legacyId", (q) => q.eq("legacyId", legacyId)).unique();
}

function batchResult(
  batch: {
    batchId: string;
    source: string;
    kind: LegacyMigrationKind;
    inputHash: string;
    recordCount: number;
    createdCount: number;
    reusedCount: number;
    completedAt: number;
  },
  reusedBatch: boolean
) {
  return { ...batch, reusedBatch };
}
