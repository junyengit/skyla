import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  catalogSnapshotRows,
  catalogVersionAuditMetadata,
  codeOwnedCatalogSeed,
  snapshotSeedFromRows,
  staleCatalogProductKeys,
  type CatalogSeedItem,
  type NormalizedCatalogSeed
} from "./lib/catalogVersioning";
import { requireStaffUser } from "./lib/auth";

const versionArg = v.string();
const noteArg = v.optional(v.string());
const maxVersionList = 25;
const maxCatalogItems = 500;

type ProductPatch = CatalogSeedItem & {
  catalogVersion: string;
  contentHash: string;
  source: string;
  authority: string;
  updatedBy: Id<"staffUsers">;
  updatedAt: number;
};

function publicCatalogVersion(row: {
  version: string;
  source: string;
  authority: string;
  status: "active" | "inactive";
  itemCount: number;
  activeItemCount: number;
  contentHash: string;
  editableInAdmin: boolean;
  createdAt: number;
  activatedAt?: number;
  deactivatedAt?: number;
  notes?: string;
}) {
  return {
    version: row.version,
    source: row.source,
    authority: row.authority,
    status: row.status,
    itemCount: row.itemCount,
    activeItemCount: row.activeItemCount,
    contentHash: row.contentHash,
    editableInAdmin: row.editableInAdmin,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    deactivatedAt: row.deactivatedAt,
    notes: row.notes
  };
}

function publicProduct(row: {
  key: string;
  kind: "ticket" | "addon" | "cafe";
  name: string;
  priceCents: number;
  active: boolean;
  category?: string;
  metadata?: Record<string, string | number | boolean>;
  catalogVersion?: string;
  source?: string;
  authority?: string;
  contentHash?: string;
  updatedAt?: number;
}) {
  return {
    key: row.key,
    kind: row.kind,
    name: row.name,
    priceCents: row.priceCents,
    active: row.active,
    category: row.category,
    metadata: row.metadata,
    catalogVersion: row.catalogVersion,
    source: row.source,
    authority: row.authority,
    contentHash: row.contentHash,
    updatedAt: row.updatedAt
  };
}

function sortCatalogItems<T extends { kind: string; key: string }>(items: T[]) {
  const kindOrder = new Map([
    ["ticket", 0],
    ["addon", 1],
    ["cafe", 2]
  ]);
  return [...items].sort((left, right) => {
    const kindDelta = (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99);
    return kindDelta || left.key.localeCompare(right.key);
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

async function activeVersions(ctx: MutationCtx) {
  return await ctx.db
    .query("catalogVersions")
    .withIndex("by_status_createdAt", (q) => q.eq("status", "active"))
    .order("desc")
    .take(maxVersionList);
}

async function deactivateActiveVersions(ctx: MutationCtx, keepVersion: string, now: number, staffUserId: Id<"staffUsers">) {
  const active = await activeVersions(ctx);
  await Promise.all(
    active
      .filter((version) => version.version !== keepVersion)
      .map((version) =>
        ctx.db.patch(version._id, {
          status: "inactive",
          deactivatedAt: now,
          deactivatedBy: staffUserId
        })
      )
  );
}

async function ensureSnapshotRows(ctx: MutationCtx, seed: NormalizedCatalogSeed, now: number) {
  const rows = catalogSnapshotRows(seed, now);
  for (const row of rows) {
    const existing = await ctx.db
      .query("productSnapshots")
      .withIndex("by_version_key", (q) => q.eq("version", row.version).eq("key", row.key))
      .unique();
    if (existing) {
      if (existing.contentHash !== row.contentHash) {
        throw new Error(`catalog snapshot for ${row.key} does not match existing immutable row`);
      }
      continue;
    }
    await ctx.db.insert("productSnapshots", row);
  }
}

async function syncCurrentProducts(
  ctx: MutationCtx,
  seed: NormalizedCatalogSeed,
  now: number,
  staffUserId: Id<"staffUsers">
) {
  const rows = catalogSnapshotRows(seed, now);
  const existingProducts = await ctx.db.query("products").take(maxCatalogItems);
  const staleKeys = new Set(staleCatalogProductKeys(existingProducts.map((product) => product.key), rows));

  for (const product of existingProducts) {
    if (staleKeys.has(product.key)) {
      await ctx.db.delete(product._id);
    }
  }

  for (const row of rows) {
    const patch = withoutUndefined({
      key: row.key,
      kind: row.kind,
      name: row.name,
      priceCents: row.priceCents,
      active: row.active,
      category: row.category,
      metadata: row.metadata,
      catalogVersion: seed.version,
      contentHash: row.contentHash,
      source: seed.source,
      authority: seed.authority,
      updatedBy: staffUserId,
      updatedAt: now
    }) as ProductPatch;
    const existing = await ctx.db
      .query("products")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("products", patch);
    }
  }
}

async function upsertCatalogVersion(
  ctx: MutationCtx,
  seed: NormalizedCatalogSeed,
  now: number,
  staffUserId: Id<"staffUsers">
) {
  const existing = await ctx.db
    .query("catalogVersions")
    .withIndex("by_version", (q) => q.eq("version", seed.version))
    .unique();

  if (existing && existing.contentHash !== seed.contentHash) {
    throw new Error("catalog version already exists with different content");
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "active",
      activatedAt: now,
      activatedBy: staffUserId,
      notes: seed.note ?? existing.notes
    });
    return { created: false };
  }

  await ctx.db.insert("catalogVersions", {
    version: seed.version,
    source: seed.source,
    authority: seed.authority,
    status: "active",
    itemCount: seed.itemCount,
    activeItemCount: seed.activeItemCount,
    contentHash: seed.contentHash,
    editableInAdmin: seed.editableInAdmin,
    createdAt: now,
    activatedAt: now,
    createdBy: staffUserId,
    activatedBy: staffUserId,
    notes: seed.note
  });
  return { created: true };
}

async function seedCatalog(ctx: MutationCtx, seed: NormalizedCatalogSeed, staffUserId: Id<"staffUsers">) {
  const now = Date.now();
  const { created } = await upsertCatalogVersion(ctx, seed, now, staffUserId);
  await ensureSnapshotRows(ctx, seed, now);
  await deactivateActiveVersions(ctx, seed.version, now, staffUserId);
  await syncCurrentProducts(ctx, seed, now, staffUserId);

  await ctx.db.insert("auditEvents", {
    actorStaffUserId: staffUserId,
    action: "catalog.version.seed",
    entityType: "catalogVersion",
    entityRef: seed.version,
    metadata: catalogVersionAuditMetadata(seed, "seed", seed.note),
    createdAt: now
  });

  return {
    version: seed.version,
    contentHash: seed.contentHash,
    itemCount: seed.itemCount,
    activeItemCount: seed.activeItemCount,
    created,
    syncedProducts: seed.itemCount,
    activatedAt: now
  };
}

export const getCatalogSnapshot = query({
  args: {
    version: v.optional(versionArg)
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin", "viewer"]);
    const [versions, products, activeRows] = await Promise.all([
      ctx.db.query("catalogVersions").withIndex("by_createdAt").order("desc").take(maxVersionList),
      ctx.db.query("products").take(maxCatalogItems),
      ctx.db
        .query("catalogVersions")
        .withIndex("by_status_createdAt", (q) => q.eq("status", "active"))
        .order("desc")
        .take(2)
    ]);
    const active = activeRows[0] ?? null;
    const snapshotVersion = args.version ?? active?.version;
    const snapshots = snapshotVersion
      ? await ctx.db
          .query("productSnapshots")
          .withIndex("by_version", (q) => q.eq("version", snapshotVersion))
          .take(maxCatalogItems)
      : [];

    return {
      staff: {
        emailLower: staffUser.emailLower,
        role: staffUser.role
      },
      activeVersion: active ? publicCatalogVersion(active) : null,
      versions: versions.map(publicCatalogVersion),
      currentProducts: sortCatalogItems(products.map(publicProduct)),
      snapshot: snapshotVersion
        ? {
            version: snapshotVersion,
            items: sortCatalogItems(snapshots.map(publicProduct))
          }
        : null
    };
  }
});

export const seedCodeOwnedCatalog = mutation({
  args: {
    note: noteArg
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    return await seedCatalog(ctx, codeOwnedCatalogSeed(args.note), staffUser._id);
  }
});

export const activateCatalogVersion = mutation({
  args: {
    version: versionArg,
    note: noteArg
  },
  handler: async (ctx, args) => {
    const staffUser = await requireStaffUser(ctx, ["admin"]);
    const version = args.version.trim();
    if (!version) {
      throw new Error("version is required");
    }

    const existing = await ctx.db
      .query("catalogVersions")
      .withIndex("by_version", (q) => q.eq("version", version))
      .unique();
    if (!existing) {
      throw new Error("catalog version not found");
    }

    const snapshots = await ctx.db
      .query("productSnapshots")
      .withIndex("by_version", (q) => q.eq("version", version))
      .take(maxCatalogItems);
    if (snapshots.length !== existing.itemCount) {
      throw new Error("catalog version snapshots are incomplete");
    }

    const seed = snapshotSeedFromRows({
      version: existing.version,
      source: existing.source,
      authority: existing.authority,
      editableInAdmin: existing.editableInAdmin,
      items: snapshots.map((snapshot) => ({
        key: snapshot.key,
        kind: snapshot.kind,
        name: snapshot.name,
        priceCents: snapshot.priceCents,
        active: snapshot.active,
        category: snapshot.category,
        metadata: snapshot.metadata
      })),
      note: args.note
    });
    if (seed.contentHash !== existing.contentHash) {
      throw new Error("catalog version snapshot hash does not match version record");
    }

    const now = Date.now();
    await deactivateActiveVersions(ctx, existing.version, now, staffUser._id);
    await ctx.db.patch(existing._id, {
      status: "active",
      activatedAt: now,
      activatedBy: staffUser._id,
      notes: seed.note ?? existing.notes
    });
    await syncCurrentProducts(ctx, seed, now, staffUser._id);

    await ctx.db.insert("auditEvents", {
      actorStaffUserId: staffUser._id,
      action: "catalog.version.activate",
      entityType: "catalogVersion",
      entityRef: seed.version,
      metadata: catalogVersionAuditMetadata(seed, "activate", seed.note),
      createdAt: now
    });

    return {
      version: seed.version,
      contentHash: seed.contentHash,
      itemCount: seed.itemCount,
      activeItemCount: seed.activeItemCount,
      syncedProducts: seed.itemCount,
      activatedAt: now
    };
  }
});
