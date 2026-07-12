import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const convexCalls = vi.hoisted(() => []);
const convexBehavior = vi.hoisted(() => ({ partialVerification: false }));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(url) {
      convexCalls.push({ operation: "connect", url });
    }

    async mutation(functionReference, args) {
      convexCalls.push({ operation: "mutation", functionReference, args });
      return { batchId: args.batchId, reusedBatch: false };
    }

    async query(functionReference, args) {
      convexCalls.push({ operation: "query", functionReference, args });
      if (args.expected) {
        const expected = convexBehavior.partialVerification ? args.expected.slice(0, -1) : args.expected;
        return {
          source: args.source,
          results: expected.map((batch) => ({ batchId: batch.batchId, verified: true }))
        };
      }
      return { source: args.source, counts: {} };
    }
  }
}));

import { prepareLegacyExport, sha256 } from "./legacy-data.mjs";
import { runLegacyMigrationCli } from "./legacy-data-cli.mjs";
import { normalizeLegacyBatchIdentity } from "../../convex/lib/legacyMigration";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  convexCalls.length = 0;
  convexBehavior.partialVerification = false;
});

function fixture() {
  return {
    bookings: [
      {
        id: "booking-1",
        created_at: "2026-07-01T12:00:00.000Z",
        data: { bookingRef: "SKY2607-LEGACY", email: "guest@example.com", adults: 2, status: "confirmed" }
      }
    ],
    members: [
      {
        id: "member-1",
        created_at: "2026-07-02T12:00:00.000Z",
        data: { firstName: "Ari", lastName: "Lee", email: "ari@example.com", status: "pending" }
      }
    ],
    inquiries: [
      {
        id: "inquiry-1",
        created_at: "2026-07-03T12:00:00.000Z",
        data: { firstName: "Jo", email: "jo@example.com", date: "2026-08-01", guests: 12 }
      }
    ]
  };
}

describe("legacy migration preparation", () => {
  it("creates deterministic SHA-256 manifests and bounded batches without PII in the manifest", () => {
    const payload = fixture();
    const first = prepareLegacyExport(payload, {
      source: "supabase:sjjtxzantrvipakliczb",
      exportedAt: "2026-07-12T10:00:00Z",
      batchSize: 1
    });
    const second = prepareLegacyExport(payload, {
      source: "supabase:sjjtxzantrvipakliczb",
      exportedAt: "2026-07-12T10:00:00.000Z",
      batchSize: 1
    });

    expect(first.manifest).toEqual(second.manifest);
    expect(first.manifest).toMatchObject({
      counts: { bookings: 1, members: 1, inquiries: 1 },
      exportedAt: "2026-07-12T10:00:00.000Z",
      sourceCount: 3,
      acceptedCount: 3,
      rejectedCount: 0,
      batchCount: 3,
      batchSize: 1
    });
    expect(first.manifest.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.manifest.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(first.manifest)).not.toContain("@example.com");
    expect(first.manifest.batches).toHaveLength(3);
    expect(first.batches.every((batch) => batch.records.length === 1)).toBe(true);
  });

  it("uses the same canonical batch hash offline and in the Convex mutation", async () => {
    const plan = prepareLegacyExport(fixture(), { source: "supabase:sjjtxzantrvipakliczb" });
    const plannedBatch = plan.batches[0];
    const normalized = await normalizeLegacyBatchIdentity({
      source: plannedBatch.source,
      batchId: plannedBatch.batchId,
      kind: plannedBatch.kind,
      records: plannedBatch.records
    });
    expect(normalized.inputHash).toBe(plannedBatch.contentHash);
  });

  it("keeps localStorage recovery records distinct from Supabase identities", () => {
    const plan = prepareLegacyExport(fixture(), { source: "localStorage:operator-export" });
    expect(plan.batches[0].records[0].legacyId).toBe("localStorage:operator-export:bookings:booking-1");
  });

  it("quarantines missing timestamps and duplicate source identities instead of silently dropping them", () => {
    const payload = fixture();
    payload.members.push({ id: "member-1", created_at: "2026-07-04T12:00:00.000Z", data: {} });
    payload.inquiries.push({ id: "inquiry-2", data: { email: "lost@example.com" } });
    payload.bookings.push({
      id: "booking-oversized",
      created_at: "2026-07-04T12:00:00.000Z",
      data: { payload: "x".repeat(65 * 1024) }
    });
    const plan = prepareLegacyExport(payload, { source: "supabase:sjjtxzantrvipakliczb" });

    expect(plan.manifest.rejectedCount).toBe(3);
    expect(plan.rejected.map((row) => row.reason)).toEqual([
      "raw record exceeds 64 KiB",
      "duplicate source row id",
      "created_at or data.createdAt is required"
    ]);
  });

  it("writes private review artifacts in dry-run mode and blocks production apply without confirmation", async () => {
    const { dir, out } = fixturePaths();
    const input = resolve(dir, "export.json");
    writeFileSync(input, JSON.stringify(fixture()));

    const manifest = runLegacyMigrationCli(
      [
        "--input",
        input,
        "--source",
        "supabase:sjjtxzantrvipakliczb",
        "--exported-at",
        "2026-07-12T10:00:00.000Z",
        "--out",
        out
      ],
      {}
    );
    expect(manifest.acceptedCount).toBe(3);
    expect(JSON.parse(readFileSync(resolve(out, "manifest.json"), "utf8"))).toMatchObject({ acceptedCount: 3 });
    await expect(
      runLegacyMigrationCli(
        [
          "--input",
          input,
          "--source",
          "supabase:sjjtxzantrvipakliczb",
          "--exported-at",
          "2026-07-12T10:00:00.000Z",
          "--out",
          out,
          "--apply",
          "--deployment",
          "prod",
          "--convex-url",
          "https://production-example.convex.cloud"
        ],
        { SKYLA_DATA_MIGRATION_TOKEN: "migration-token-with-at-least-32-characters" }
      )
    ).rejects.toThrow("--confirm-production is required");
  });

  it("hashes raw input text distinctly from normalized plans", () => {
    expect(sha256('{"a":1}')).not.toBe(sha256('{ "a": 1 }'));
  });

  it("keeps all PII-bearing review output under the ignored .migration directory", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "skyla-legacy-migration-"));
    tempDirs.push(dir);
    const input = resolve(dir, "export.json");
    writeFileSync(input, JSON.stringify(fixture()));
    expect(() =>
      runLegacyMigrationCli([
        "--input",
        input,
        "--source",
        "supabase:sjjtxzantrvipakliczb",
        "--exported-at",
        "2026-07-12T10:00:00.000Z",
        "--out",
        resolve(dir, "review")
      ])
    ).toThrow("ignored repository .migration directory");
  });

  it("refuses to apply when a reviewed artifact changed after the dry run", () => {
    const { dir, out } = fixturePaths();
    const input = resolve(dir, "export.json");
    writeFileSync(input, JSON.stringify(fixture()));
    runLegacyMigrationCli([
      "--input",
      input,
      "--source",
      "supabase:sjjtxzantrvipakliczb",
      "--exported-at",
      "2026-07-12T10:00:00.000Z",
      "--out",
      out
    ]);
    writeFileSync(resolve(out, "manifest.json"), "{}\n");

    expect(() =>
      runLegacyMigrationCli(
        [
          "--input",
          input,
          "--source",
          "supabase:sjjtxzantrvipakliczb",
          "--exported-at",
          "2026-07-12T10:00:00.000Z",
          "--out",
          out,
          "--apply",
          "--deployment",
          "dev"
        ],
        { SKYLA_DATA_MIGRATION_TOKEN: "migration-token-with-at-least-32-characters" }
      )
    ).toThrow("reviewed migration artifact does not match");
  });

  it("applies reviewed batches over the Convex HTTPS client without process arguments", async () => {
    const { dir, out } = fixturePaths();
    const input = resolve(dir, "export.json");
    const baseArgs = [
      "--input",
      input,
      "--source",
      "supabase:sjjtxzantrvipakliczb",
      "--exported-at",
      "2026-07-12T10:00:00.000Z",
      "--out",
      out
    ];
    writeFileSync(input, JSON.stringify(fixture()));
    runLegacyMigrationCli(baseArgs);

    const result = await runLegacyMigrationCli(
      [
        ...baseArgs,
        "--apply",
        "--deployment",
        "dev",
        "--convex-url",
        "https://example.convex.cloud",
        "--confirm-production"
      ],
      { SKYLA_DATA_MIGRATION_TOKEN: "migration-token-with-at-least-32-characters" }
    );

    expect(result.acceptedCount).toBe(3);
    expect(convexCalls.filter((call) => call.operation === "mutation")).toHaveLength(3);
    expect(convexCalls[0]).toEqual({ operation: "connect", url: "https://example.convex.cloud" });
    expect(convexCalls[1].args.migrationToken).toBe("migration-token-with-at-least-32-characters");

    const summary = await runLegacyMigrationCli(
      [
        "--summary",
        "--source",
        "supabase:sjjtxzantrvipakliczb",
        "--out",
        out,
        "--deployment",
        "dev",
        "--convex-url",
        "https://example.convex.cloud"
      ],
      { SKYLA_DATA_MIGRATION_TOKEN: "migration-token-with-at-least-32-characters" }
    );
    expect(summary.source).toBe("supabase:sjjtxzantrvipakliczb");
    expect(convexCalls.filter((call) => call.operation === "query")).toHaveLength(2);
  });

  it("rejects truncated manifests and partial Convex verification responses", async () => {
    const { dir, out } = fixturePaths();
    const input = resolve(dir, "export.json");
    const args = [
      "--input",
      input,
      "--source",
      "supabase:sjjtxzantrvipakliczb",
      "--exported-at",
      "2026-07-12T10:00:00.000Z",
      "--out",
      out
    ];
    const summaryArgs = [
      "--summary",
      "--source",
      "supabase:sjjtxzantrvipakliczb",
      "--out",
      out,
      "--deployment",
      "dev",
      "--convex-url",
      "https://example.convex.cloud"
    ];
    const env = { SKYLA_DATA_MIGRATION_TOKEN: "migration-token-with-at-least-32-characters" };
    writeFileSync(input, JSON.stringify(fixture()));
    runLegacyMigrationCli(args);

    const manifestPath = resolve(out, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.batches.pop();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(runLegacyMigrationCli(summaryArgs, env)).rejects.toThrow("does not match the requested source");

    rmSync(out, { recursive: true, force: true });
    runLegacyMigrationCli(args);
    convexBehavior.partialVerification = true;
    await expect(runLegacyMigrationCli(summaryArgs, env)).rejects.toThrow("failed reconciliation");
  });
});

function fixturePaths() {
  const dir = mkdtempSync(resolve(tmpdir(), "skyla-legacy-migration-"));
  const migrationRoot = resolve(process.cwd(), ".migration");
  mkdirSync(migrationRoot, { recursive: true, mode: 0o700 });
  const out = resolve(migrationRoot, `test-${basename(dir)}`);
  tempDirs.push(dir, out);
  return { dir, out };
}
