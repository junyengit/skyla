import {
  catalogProvenance,
  catalogVersion,
  listCatalogItems,
  type Addon,
  type CafeItem,
  type CatalogItem,
  type TicketPackage
} from "@skyla/payments";

export const catalogKinds = ["ticket", "addon", "cafe"] as const;
export const catalogStatuses = ["active", "inactive"] as const;

export type CatalogKind = (typeof catalogKinds)[number];
export type CatalogVersionStatus = (typeof catalogStatuses)[number];

export type CatalogSeedItem = {
  key: string;
  kind: CatalogKind;
  name: string;
  priceCents: number;
  active: boolean;
  category?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type CatalogSeed = {
  version: string;
  source: string;
  authority: string;
  editableInAdmin: boolean;
  items: CatalogSeedItem[];
  note?: string;
};

export type NormalizedCatalogSeed = CatalogSeed & {
  itemCount: number;
  activeItemCount: number;
  contentHash: string;
};

const maxVersionLength = 120;
const maxSourceLength = 80;
const maxAuthorityLength = 40;
const maxKeyLength = 80;
const maxNameLength = 160;
const maxCategoryLength = 60;
const maxNoteLength = 180;
const maxPriceCents = 1_000_000;

export function codeOwnedCatalogSeed(note?: string): NormalizedCatalogSeed {
  return normalizeCatalogSeed({
    version: catalogVersion,
    source: catalogProvenance.source,
    authority: catalogProvenance.authority,
    editableInAdmin: catalogProvenance.editableInAdmin,
    items: listCatalogItems({ activeOnly: false }).map(seedItemFromCatalogItem),
    note
  });
}

export function normalizeCatalogSeed(input: CatalogSeed): NormalizedCatalogSeed {
  const version = boundedString(input.version, "version", maxVersionLength);
  const source = boundedString(input.source, "source", maxSourceLength);
  const authority = boundedString(input.authority, "authority", maxAuthorityLength);
  const items = sortSeedItems(input.items.map(normalizeCatalogSeedItem));
  if (!items.length) {
    throw new Error("catalog seed must include at least one item");
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) {
      throw new Error(`catalog seed contains duplicate item key ${item.key}`);
    }
    seen.add(item.key);
  }

  const seed: CatalogSeed = withoutUndefined({
    version,
    source,
    authority,
    editableInAdmin: Boolean(input.editableInAdmin),
    items,
    note: optionalNote(input.note)
  });

  return {
    ...seed,
    itemCount: seed.items.length,
    activeItemCount: seed.items.filter((item) => item.active).length,
    contentHash: stableContentHash({
      version: seed.version,
      source: seed.source,
      authority: seed.authority,
      editableInAdmin: seed.editableInAdmin,
      items: seed.items
    })
  };
}

export function catalogSnapshotRows(seed: NormalizedCatalogSeed, createdAt: number) {
  return seed.items.map((item) => ({
    ...item,
    version: seed.version,
    contentHash: stableContentHash(item),
    createdAt
  }));
}

export function staleCatalogProductKeys(currentKeys: string[], seedItems: Array<Pick<CatalogSeedItem, "key">>) {
  const seeded = new Set(seedItems.map((item) => item.key));
  return [...new Set(currentKeys.filter((key) => !seeded.has(key)))].sort();
}

export function catalogVersionAuditMetadata(
  seed: Pick<NormalizedCatalogSeed, "version" | "source" | "authority" | "itemCount" | "activeItemCount" | "contentHash">,
  action: "seed" | "activate",
  note?: string
) {
  const metadata: Record<string, string | number | boolean> = {
    version: seed.version,
    source: seed.source,
    authority: seed.authority,
    itemCount: seed.itemCount,
    activeItemCount: seed.activeItemCount,
    contentHash: seed.contentHash,
    action
  };
  const normalizedNote = optionalNote(note);
  if (normalizedNote) {
    metadata.note = normalizedNote;
  }
  return metadata;
}

export function snapshotSeedFromRows(input: {
  version: string;
  source: string;
  authority: string;
  editableInAdmin: boolean;
  items: CatalogSeedItem[];
  note?: string;
}) {
  return normalizeCatalogSeed(input);
}

function seedItemFromCatalogItem(item: CatalogItem): CatalogSeedItem {
  const base = {
    key: item.key,
    kind: kindFromCatalogItem(item),
    name: item.name,
    priceCents: item.priceCents,
    active: item.active
  };

  if (isCafeItem(item)) {
    return {
      ...base,
      kind: "cafe",
      category: item.category
    };
  }

  if (isTicketPackage(item)) {
    return withoutUndefined({
      ...base,
      kind: "ticket",
      metadata: compactMetadata({
        entryIncluded: item.entryIncluded,
        minAdults: item.minAdults,
        roomFeeCents: item.roomFeeCents
      })
    });
  }

  if (isAddon(item)) {
    return {
      ...base,
      kind: "addon"
    };
  }

  return base;
}

function normalizeCatalogSeedItem(input: CatalogSeedItem): CatalogSeedItem {
  const kind = normalizeCatalogKind(input.kind);
  const key = boundedString(input.key, "item.key", maxKeyLength);
  const category = input.category === undefined ? undefined : boundedString(input.category, "item.category", maxCategoryLength);
  if (kind !== "cafe" && category) {
    throw new Error("item.category is only allowed for cafe items");
  }
  if (kind === "cafe" && !category) {
    throw new Error("cafe items require a category");
  }

  return withoutUndefined({
    key,
    kind,
    name: boundedString(input.name, "item.name", maxNameLength),
    priceCents: normalizePriceCents(input.priceCents),
    active: normalizeBoolean(input.active, "item.active"),
    category,
    metadata: normalizeMetadata(input.metadata)
  });
}

function normalizeCatalogKind(value: unknown): CatalogKind {
  if (!catalogKinds.includes(value as CatalogKind)) {
    throw new Error("item.kind is not recognized");
  }
  return value as CatalogKind;
}

function normalizePriceCents(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > maxPriceCents) {
    throw new Error(`item.priceCents must be an integer from 0 to ${maxPriceCents}`);
  }
  return value as number;
}

function normalizeBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function normalizeMetadata(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("item.metadata must be an object");
  }
  return compactMetadata(value as Record<string, unknown>);
}

function compactMetadata(input: Record<string, unknown>) {
  const entries = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error(`item.metadata.${key} must be a string, number, or boolean`);
      }
      return [boundedString(key, "item.metadata key", 40), value] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function boundedString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`${label} must not contain control characters`);
  }
  return trimmed;
}

function optionalNote(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("note must be a string");
  }
  const trimmed = value.trim();
  return trimmed ? boundedString(trimmed, "note", maxNoteLength) : undefined;
}

function stableContentHash(value: unknown) {
  const payload = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}:${payload.length}`;
}

function sortSeedItems(items: CatalogSeedItem[]) {
  const kindOrder = new Map<CatalogKind, number>([
    ["ticket", 0],
    ["addon", 1],
    ["cafe", 2]
  ]);
  return [...items].sort((left, right) => {
    const kindDelta = (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99);
    return kindDelta || left.key.localeCompare(right.key);
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function kindFromCatalogItem(item: CatalogItem): CatalogKind {
  if (isTicketPackage(item)) {
    return "ticket";
  }
  if (isAddon(item)) {
    return "addon";
  }
  return "cafe";
}

function isTicketPackage(item: CatalogItem): item is TicketPackage {
  return "kind" in item && item.kind === "ticket";
}

function isAddon(item: CatalogItem): item is Addon {
  return "kind" in item && item.kind === "addon";
}

function isCafeItem(item: CatalogItem): item is CafeItem {
  return "kind" in item && item.kind === "cafe";
}
