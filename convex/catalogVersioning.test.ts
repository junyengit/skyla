import { describe, expect, it } from "vitest";

import {
  catalogSnapshotRows,
  catalogVersionAuditMetadata,
  codeOwnedCatalogSeed,
  normalizeCatalogSeed,
  snapshotSeedFromRows,
  staleCatalogProductKeys
} from "./lib/catalogVersioning";

const seed = {
  version: "catalog-2026-07-05",
  source: "@skyla/payments",
  authority: "code-owned",
  editableInAdmin: false,
  items: [
    {
      key: "general",
      kind: "ticket" as const,
      name: "General Admission",
      priceCents: 2900,
      active: true
    },
    {
      key: "m1",
      kind: "cafe" as const,
      category: "matcha",
      name: "Ceremonial Matcha Latte",
      priceCents: 800,
      active: true
    }
  ]
};

describe("catalog versioning helpers", () => {
  it("builds a deterministic code-owned catalog seed", () => {
    const first = codeOwnedCatalogSeed(" initial seed ");
    const second = codeOwnedCatalogSeed("initial seed");

    expect(first.version).toBe("skyla-payments-catalog-2026-07-05");
    expect(first.source).toBe("@skyla/payments");
    expect(first.authority).toBe("code-owned");
    expect(first.editableInAdmin).toBe(false);
    expect(first.itemCount).toBeGreaterThan(20);
    expect(first.activeItemCount).toBeGreaterThan(10);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.note).toBe("initial seed");
  });

  it("changes content identity when catalog content changes but not when notes change", () => {
    const original = normalizeCatalogSeed({ ...seed, note: "operator one" });
    const sameContent = normalizeCatalogSeed({ ...seed, note: "operator two" });
    const changedPrice = normalizeCatalogSeed({
      ...seed,
      items: seed.items.map((item) => (item.key === "general" ? { ...item, priceCents: item.priceCents + 100 } : item))
    });
    const changedActive = normalizeCatalogSeed({
      ...seed,
      items: seed.items.map((item) => (item.key === "m1" ? { ...item, active: false } : item))
    });

    expect(sameContent.contentHash).toBe(original.contentHash);
    expect(changedPrice.contentHash).not.toBe(original.contentHash);
    expect(changedActive.contentHash).not.toBe(original.contentHash);
  });

  it("rejects duplicate global product keys before seeding", () => {
    expect(() =>
      normalizeCatalogSeed({
        ...seed,
        items: [
          ...seed.items,
          {
            key: "general",
            kind: "addon",
            name: "Duplicate",
            priceCents: 100,
            active: true
          }
        ]
      })
    ).toThrow("catalog seed contains duplicate item key general");
  });

  it("validates cafe categories and compact metadata values", () => {
    expect(() =>
      normalizeCatalogSeed({
        ...seed,
        items: [
          {
            key: "m2",
            kind: "cafe",
            name: "Matcha Flight",
            priceCents: 1800,
            active: true
          }
        ]
      })
    ).toThrow("cafe items require a category");

    expect(() =>
      normalizeCatalogSeed({
        ...seed,
        items: [
          {
            key: "general",
            kind: "ticket",
            name: "General Admission",
            priceCents: 2900,
            active: true,
            metadata: { nested: { bad: true } } as never
          }
        ]
      })
    ).toThrow("item.metadata.nested must be a string, number, or boolean");
  });

  it("creates immutable snapshot rows and can reconstruct the same version hash", () => {
    const normalized = normalizeCatalogSeed(seed);
    const rows = catalogSnapshotRows(normalized, 1783292200000);
    const reconstructed = snapshotSeedFromRows({
      version: normalized.version,
      source: normalized.source,
      authority: normalized.authority,
      editableInAdmin: normalized.editableInAdmin,
      items: rows.map((row) => ({
        key: row.key,
        kind: row.kind,
        name: row.name,
        priceCents: row.priceCents,
        active: row.active,
        category: row.category,
        metadata: row.metadata
      }))
    });

    expect(rows).toEqual([
      expect.objectContaining({ version: normalized.version, key: "general", contentHash: expect.stringMatching(/^fnv1a32:/) }),
      expect.objectContaining({ version: normalized.version, key: "m1", contentHash: expect.stringMatching(/^fnv1a32:/) })
    ]);
    expect(reconstructed.contentHash).toBe(normalized.contentHash);
  });

  it("keeps audit metadata compact for seed and activation events", () => {
    const normalized = normalizeCatalogSeed(seed);

    expect(catalogVersionAuditMetadata(normalized, "seed", " first load ")).toEqual({
      version: normalized.version,
      source: "@skyla/payments",
      authority: "code-owned",
      itemCount: 2,
      activeItemCount: 2,
      contentHash: normalized.contentHash,
      action: "seed",
      note: "first load"
    });
  });

  it("identifies stale current products omitted from a newly activated seed", () => {
    expect(staleCatalogProductKeys(["m1", "old-room", "general", "old-room"], seed.items)).toEqual(["old-room"]);
  });
});
