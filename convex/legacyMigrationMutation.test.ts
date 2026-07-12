import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLegacyMigrationSummary,
  rollbackLegacyBatch,
  upsertLegacyBatch,
  verifyLegacyMigrationBatches
} from "./legacyMigration";

declare const process: { env: Record<string, string | undefined> };

type TableName =
  | "bookings"
  | "members"
  | "inquiries"
  | "legacyMigrationBatches"
  | "legacyImportRecords"
  | "legacyMigrationSources"
  | "legacyMigrationTargets"
  | "voucherRedemptionEvents"
  | "auditEvents";
type Doc = Record<string, unknown> & { _id: string; _creationTime: number };
type State = Record<TableName, Doc[]>;

const migrationToken = "migration-token-with-at-least-32-characters";
const previousToken = process.env.SKYLA_DATA_MIGRATION_TOKEN;

beforeEach(() => {
  process.env.SKYLA_DATA_MIGRATION_TOKEN = migrationToken;
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.SKYLA_DATA_MIGRATION_TOKEN;
  else process.env.SKYLA_DATA_MIGRATION_TOKEN = previousToken;
});

function memberBatch(
  batchId = "skyla-legacy:members:0001:abc123",
  firstName = "Ari",
  source = "supabase:sjjtxzantrvipakliczb"
) {
  return {
    migrationToken,
    source,
    batchId,
    kind: "members" as const,
    records: [
      {
        legacyId: `${source}:members:member-1`,
        createdAt: Date.UTC(2026, 6, 1, 12),
        raw: { firstName, lastName: "Lee", email: "ari@example.com", status: "pending" }
      }
    ]
  };
}

async function runUpsert(ctx: any, args: any = memberBatch()) {
  const mutation = upsertLegacyBatch as unknown as { _handler: (ctx: any, args: any) => Promise<any> };
  return mutation._handler(ctx, args);
}

async function runRollback(ctx: any, batchId: string) {
  const mutation = rollbackLegacyBatch as unknown as {
    _handler: (ctx: any, args: { migrationToken: string; batchId: string }) => Promise<any>;
  };
  return mutation._handler(ctx, { migrationToken, batchId });
}

async function runSummary(ctx: any) {
  const query = getLegacyMigrationSummary as unknown as {
    _handler: (ctx: any, args: { migrationToken: string; source: string }) => Promise<any>;
  };
  return query._handler(ctx, { migrationToken, source: "supabase:sjjtxzantrvipakliczb" });
}

async function runBatchVerification(ctx: any, expected: Array<{ batchId: string; inputHash: string }>) {
  const query = verifyLegacyMigrationBatches as unknown as {
    _handler: (ctx: any, args: { migrationToken: string; source: string; expected: typeof expected }) => Promise<any>;
  };
  return query._handler(ctx, { migrationToken, source: "supabase:sjjtxzantrvipakliczb", expected });
}

describe("legacy migration mutations", () => {
  it("creates one canonical record, ledger row, batch row, and PII-safe audit event", async () => {
    const { ctx, state } = createCtx();
    const result = await runUpsert(ctx);

    expect(result).toMatchObject({ recordCount: 1, createdCount: 1, reusedCount: 0, reusedBatch: false });
    expect(state.members).toHaveLength(1);
    expect(state.members[0]).toMatchObject({
      firstName: "Ari",
      emailLower: "ari@example.com",
      legacyId: "supabase:sjjtxzantrvipakliczb:members:member-1",
      legacySource: "supabase:sjjtxzantrvipakliczb"
    });
    expect(state.legacyImportRecords[0]).toMatchObject({ operation: "created", targetId: state.members[0]._id });
    expect(state.legacyMigrationBatches).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({ action: "legacyMigration.batch.upsert" });
    expect(JSON.stringify(state.auditEvents[0])).not.toContain("ari@example.com");
  });

  it("makes exact batch replay a no-op and rejects changed input under the same batch id", async () => {
    const { ctx, state } = createCtx();
    const first = await runUpsert(ctx);
    const replay = await runUpsert(ctx);

    expect(first.reusedBatch).toBe(false);
    expect(replay.reusedBatch).toBe(true);
    expect(state.members).toHaveLength(1);
    expect(state.legacyImportRecords).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
    await expect(runUpsert(ctx, memberBatch(first.batchId, "Changed"))).rejects.toThrow(
      "batchId was already used for different legacy migration input"
    );
  });

  it("refuses changed source data so a stale export cannot overwrite operational edits", async () => {
    const { ctx, state } = createCtx();
    await runUpsert(ctx);
    const changedBatch = memberBatch("skyla-legacy:members:0002:def456", "Aria");

    await expect(runUpsert(ctx, changedBatch)).rejects.toThrow("resolve it manually");
    expect(state.members[0].firstName).toBe("Ari");
    expect(state.legacyMigrationBatches).toHaveLength(1);
    expect(state.members).toHaveLength(1);
  });

  it("rolls back only untouched records created by the batch and makes rollback replay safe", async () => {
    const { ctx, state } = createCtx();
    const imported = await runUpsert(ctx);
    const rollback = await runRollback(ctx, imported.batchId);
    const replay = await runRollback(ctx, imported.batchId);

    expect(rollback).toMatchObject({ deletedCount: 1, manualReviewCount: 0, reusedRollback: false });
    expect(replay).toMatchObject({ deletedCount: 1, manualReviewCount: 0, reusedRollback: true });
    expect(state.members).toHaveLength(0);
    expect(state.legacyMigrationSources[0]).toMatchObject({ memberCount: 0, activeBatchCount: 0 });
    expect(state.auditEvents.map((event) => event.action)).toEqual([
      "legacyMigration.batch.upsert",
      "legacyMigration.batch.rollback"
    ]);
    await expect(runUpsert(ctx)).rejects.toThrow("rolled-back migration");
  });

  it("refuses rollback when a created target changed after import", async () => {
    const { ctx, state } = createCtx();
    const imported = await runUpsert(ctx);
    state.members[0].status = "approved";

    await expect(runRollback(ctx, imported.batchId)).rejects.toThrow("changed after import");
    expect(state.members).toHaveLength(1);
    expect(state.legacyMigrationBatches[0].rolledBackAt).toBeUndefined();
  });

  it("summarizes unique active source identities without exposing imported PII", async () => {
    const { ctx } = createCtx();
    await runUpsert(ctx);
    await runUpsert(ctx, memberBatch("skyla-legacy:members:0002:def456"));

    const summary = await runSummary(ctx);
    expect(summary).toMatchObject({
      counts: { bookings: 0, members: 1, inquiries: 0 },
      uniqueRecordCount: 1,
      ledgerRecordCount: 2,
      batchCount: 2,
      activeBatchCount: 2
    });
    expect(JSON.stringify(summary)).not.toContain("ari@example.com");
    expect(JSON.stringify(summary)).not.toContain("Aria");
  });

  it("refuses to roll back a target referenced by a later active batch", async () => {
    const { ctx, state } = createCtx();
    const first = await runUpsert(ctx);
    await runUpsert(ctx, memberBatch("skyla-legacy:members:0002:def456"));

    await expect(runRollback(ctx, first.batchId)).rejects.toThrow("later active batch");
    expect(state.members).toHaveLength(1);
    expect(state.legacyMigrationBatches[0].rolledBackAt).toBeUndefined();
  });

  it("verifies every manifest batch by source, hash, and active state", async () => {
    const { ctx } = createCtx();
    const imported = await runUpsert(ctx);
    const verification = await runBatchVerification(ctx, [
      { batchId: imported.batchId, inputHash: imported.inputHash },
      { batchId: "missing-batch", inputHash: "sha256:missing" }
    ]);
    expect(verification.results).toEqual([
      { batchId: imported.batchId, verified: true },
      { batchId: "missing-batch", verified: false }
    ]);
  });

  it("keeps identical row ids from different source projects separate", async () => {
    const { ctx, state } = createCtx();
    await runUpsert(ctx);
    await runUpsert(
      ctx,
      memberBatch("skyla-legacy:members:other-source", "Ari", "supabase:anotherprojectref")
    );

    expect(state.members).toHaveLength(2);
    expect(state.members.map((member) => member.legacyId)).toEqual([
      "supabase:sjjtxzantrvipakliczb:members:member-1",
      "supabase:anotherprojectref:members:member-1"
    ]);
  });

  it("refuses a legacy booking reference that collides with an existing native booking", async () => {
    const { ctx, state } = createCtx();
    state.bookings.push({
      _id: "bookings_native",
      _creationTime: Date.now(),
      bookingRef: "SKY-NATIVE-1",
      status: "confirmed",
      createdAt: Date.now()
    });

    await expect(
      runUpsert(ctx, {
        migrationToken,
        source: "supabase:sjjtxzantrvipakliczb",
        batchId: "skyla-legacy:bookings:collision",
        kind: "bookings",
        records: [
          {
            legacyId: "supabase:sjjtxzantrvipakliczb:bookings:booking-1",
            createdAt: Date.UTC(2026, 6, 1, 12),
            raw: { bookingRef: "SKY-NATIVE-1", status: "confirmed" }
          }
        ]
      })
    ).rejects.toThrow("booking reference conflicts");
    expect(state.bookings).toHaveLength(1);
  });

  it("refuses to delete an imported booking after voucher history exists", async () => {
    const { ctx, state } = createCtx();
    const imported = await runUpsert(ctx, {
      migrationToken,
      source: "supabase:sjjtxzantrvipakliczb",
      batchId: "skyla-legacy:bookings:voucher-history",
      kind: "bookings",
      records: [
        {
          legacyId: "supabase:sjjtxzantrvipakliczb:bookings:booking-voucher",
          createdAt: Date.UTC(2026, 6, 1, 12),
          raw: { bookingRef: "SKY-VOUCHER-1", status: "confirmed" }
        }
      ]
    });
    state.voucherRedemptionEvents.push({
      _id: "voucher_event_1",
      _creationTime: Date.now(),
      bookingRef: "SKY-VOUCHER-1",
      voucherId: "voucher-1",
      delta: 1,
      actorStaffUserId: "staff-1",
      createdAt: Date.now()
    });

    await expect(runRollback(ctx, imported.batchId)).rejects.toThrow("has voucher history");
    expect(state.bookings).toHaveLength(1);
  });
});

function createCtx(): { ctx: any; state: State } {
  const state: State = {
    bookings: [],
    members: [],
    inquiries: [],
    legacyMigrationBatches: [],
    legacyImportRecords: [],
    legacyMigrationSources: [],
    legacyMigrationTargets: [],
    voucherRedemptionEvents: [],
    auditEvents: []
  };
  let nextId = 1;
  const ctx = {
    db: {
      query(table: TableName) {
        return {
          withIndex(
            _index: string,
            build: (query: { eq: (field: string, value: unknown) => unknown }) => unknown
          ) {
            const filters: Array<{ field: string; value: unknown }> = [];
            const query = {
              eq(field: string, value: unknown) {
                filters.push({ field, value });
                return query;
              }
            };
            build(query);
            const collect = async () =>
              state[table].filter((doc) => filters.every(({ field, value }) => doc[field] === value));
            const result = {
              collect,
              async unique() {
                const matches = await collect();
                if (matches.length > 1) throw new Error("Expected unique result");
                return matches[0];
              },
              async first() {
                return (await collect())[0];
              },
              order() {
                return result;
              },
              async take(count: number) {
                return (await collect()).slice(0, count);
              }
            };
            return result;
          }
        };
      },
      async insert(table: TableName, value: Record<string, unknown>) {
        const doc = { ...value, _id: `${table}_${nextId++}`, _creationTime: Date.now() };
        state[table].push(doc);
        return doc._id;
      },
      async patch(id: string, value: Record<string, unknown>) {
        const doc = Object.values(state).flat().find((candidate) => candidate._id === id);
        if (!doc) throw new Error(`Missing ${id}`);
        Object.assign(doc, value);
      },
      async delete(id: string) {
        for (const docs of Object.values(state)) {
          const index = docs.findIndex((doc) => doc._id === id);
          if (index >= 0) {
            docs.splice(index, 1);
            return;
          }
        }
        throw new Error(`Missing ${id}`);
      }
    }
  };
  return { ctx, state };
}
