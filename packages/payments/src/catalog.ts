export type TicketPackageKey =
  | "general"
  | "drink"
  | "date-night"
  | "champagne-room"
  | "family-suite";

export type AddonKey = "matcha" | "pourover" | "hojicha" | "coldbrew";

export type CafeItemKey =
  | "m1"
  | "m2"
  | "m3"
  | "m4"
  | "c1"
  | "c2"
  | "c3"
  | "c4"
  | "c5"
  | "c6"
  | "c7"
  | "c8"
  | "c9"
  | "c10"
  | "b1"
  | "b2"
  | "b3"
  | "b4"
  | "b5"
  | "b6"
  | "b7"
  | "b8";

export type CatalogItem = {
  key: string;
  name: string;
  priceCents: number;
  active: boolean;
};

export type TicketPackage = CatalogItem & {
  key: TicketPackageKey;
  kind: "ticket";
  entryIncluded?: boolean;
  roomFeeCents?: number;
  minAdults?: number;
};

export type Addon = CatalogItem & {
  key: AddonKey;
  kind: "addon";
};

export type CafeItem = CatalogItem & {
  key: CafeItemKey;
  kind: "cafe";
  category: "matcha" | "coffee" | "bites";
};

export type CatalogListOptions = {
  activeOnly?: boolean;
};

export const catalogVersion = "skyla-payments-catalog-2026-07-20" as const;
export const catalogProvenance = {
  version: catalogVersion,
  source: "@skyla/payments",
  authority: "code-owned",
  editableInAdmin: false
} as const;

export type CatalogPricedItem = TicketPackage | Addon | CafeItem;

export type CatalogLineMetadata = {
  catalogVersion: string;
  catalogSource: string;
  catalogAuthority: string;
  catalogContentHash: string;
};

export const bookingFeeRate = 0.05;
export const childDiscountRate = 0.5;

export const ticketPackages = {
  general: {
    key: "general",
    kind: "ticket",
    name: "The View",
    priceCents: 2000,
    active: true
  },
  drink: {
    key: "drink",
    kind: "ticket",
    name: "Deck + Drink",
    priceCents: 3700,
    active: false
  },
  "date-night": {
    key: "date-night",
    kind: "ticket",
    name: "Date Night Experience",
    priceCents: 9800,
    active: false,
    entryIncluded: true,
    minAdults: 2
  },
  "champagne-room": {
    key: "champagne-room",
    kind: "ticket",
    name: "Champagne Room",
    priceCents: 0,
    active: false,
    entryIncluded: true,
    roomFeeCents: 35000
  },
  "family-suite": {
    key: "family-suite",
    kind: "ticket",
    name: "Family Suite",
    priceCents: 0,
    active: false,
    roomFeeCents: 25000
  }
} as const satisfies Record<TicketPackageKey, TicketPackage>;

export const addons = {
  matcha: { key: "matcha", kind: "addon", name: "Ceremonial Matcha Latte", priceCents: 800, active: true },
  pourover: { key: "pourover", kind: "addon", name: "Single-Origin Pour Over", priceCents: 800, active: true },
  hojicha: { key: "hojicha", kind: "addon", name: "Iced Matcha Hojicha Latte", priceCents: 800, active: true },
  coldbrew: { key: "coldbrew", kind: "addon", name: "Iced Mocha Cold Brew", priceCents: 800, active: true }
} as const satisfies Record<AddonKey, Addon>;

export const cafeItems = {
  m1: { key: "m1", kind: "cafe", category: "matcha", name: "Ceremonial Matcha Latte", priceCents: 800, active: true },
  m2: { key: "m2", kind: "cafe", category: "matcha", name: "Matcha Tasting Flight", priceCents: 1800, active: true },
  m3: { key: "m3", kind: "cafe", category: "matcha", name: "Iced Hojicha Latte", priceCents: 800, active: true },
  m4: { key: "m4", kind: "cafe", category: "matcha", name: "Matcha Affogato", priceCents: 1400, active: true },
  c1: { key: "c1", kind: "cafe", category: "coffee", name: "Single-Origin Pour Over", priceCents: 800, active: true },
  c2: { key: "c2", kind: "cafe", category: "coffee", name: "Iced Mocha Cold Brew", priceCents: 800, active: true },
  c3: { key: "c3", kind: "cafe", category: "coffee", name: "Cortado", priceCents: 800, active: true },
  c4: { key: "c4", kind: "cafe", category: "coffee", name: "Oat Milk Latte", priceCents: 900, active: true },
  c5: { key: "c5", kind: "cafe", category: "coffee", name: "Espresso", priceCents: 600, active: true },
  c6: { key: "c6", kind: "cafe", category: "coffee", name: "Double Espresso", priceCents: 800, active: true },
  c7: { key: "c7", kind: "cafe", category: "coffee", name: "Cappuccino", priceCents: 900, active: true },
  c8: { key: "c8", kind: "cafe", category: "coffee", name: "Flat White", priceCents: 900, active: true },
  c9: { key: "c9", kind: "cafe", category: "coffee", name: "Americano", priceCents: 700, active: true },
  c10: { key: "c10", kind: "cafe", category: "coffee", name: "Iced Espresso Tonic", priceCents: 1000, active: true },
  b1: { key: "b1", kind: "cafe", category: "bites", name: "Butter Croissant", priceCents: 600, active: true },
  b2: { key: "b2", kind: "cafe", category: "bites", name: "Matcha Financier", priceCents: 700, active: true },
  b3: { key: "b3", kind: "cafe", category: "bites", name: "Dark Chocolate Brownie", priceCents: 600, active: true },
  b4: { key: "b4", kind: "cafe", category: "bites", name: "Seasonal Fruit Tart", priceCents: 900, active: true },
  b5: { key: "b5", kind: "cafe", category: "bites", name: "Lemon Olive Oil Cake", priceCents: 800, active: true },
  b6: { key: "b6", kind: "cafe", category: "bites", name: "Hojicha Shortbread", priceCents: 500, active: true },
  b7: { key: "b7", kind: "cafe", category: "bites", name: "Overnight Oat Parfait", priceCents: 1000, active: true },
  b8: { key: "b8", kind: "cafe", category: "bites", name: "Avocado Toast", priceCents: 1200, active: true }
} as const satisfies Record<CafeItemKey, CafeItem>;

export function childPriceCents(priceCents: number) {
  return Math.ceil((priceCents / 100) * childDiscountRate) * 100;
}

export function bookingFeeCents(subtotalCents: number) {
  return Math.round(subtotalCents * bookingFeeRate);
}

function catalogValues<T extends CatalogItem>(items: Record<string, T>, options: CatalogListOptions = {}) {
  const values = Object.values(items);
  return options.activeOnly === false ? values : values.filter((item) => item.active);
}

export function listTicketPackages(options?: CatalogListOptions) {
  return catalogValues(ticketPackages, options);
}

export function listAddons(options?: CatalogListOptions) {
  return catalogValues(addons, options);
}

export function listCafeItems(options?: CatalogListOptions) {
  return catalogValues(cafeItems, options);
}

export function listCatalogItems(options?: CatalogListOptions) {
  return [...listTicketPackages(options), ...listAddons(options), ...listCafeItems(options)];
}

export function catalogItemContentHash(item: CatalogPricedItem) {
  return stableContentHash(catalogSnapshotItem(item));
}

export function catalogLineMetadata(item: CatalogPricedItem): CatalogLineMetadata {
  return {
    catalogVersion,
    catalogSource: catalogProvenance.source,
    catalogAuthority: catalogProvenance.authority,
    catalogContentHash: catalogItemContentHash(item)
  };
}

function catalogSnapshotItem(item: CatalogPricedItem) {
  const base = {
    key: item.key,
    kind: item.kind,
    name: item.name,
    priceCents: item.priceCents,
    active: item.active
  };

  if (item.kind === "cafe") {
    return {
      ...base,
      category: item.category
    };
  }

  if (item.kind === "ticket") {
    return compactObject({
      ...base,
      metadata: compactObject({
        entryIncluded: item.entryIncluded,
        minAdults: item.minAdults,
        roomFeeCents: item.roomFeeCents
      })
    });
  }

  return base;
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  const compact = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  return Object.keys(compact).length ? compact : undefined;
}
