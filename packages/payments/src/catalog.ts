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

export const bookingFeeRate = 0.05;
export const childDiscountRate = 0.5;

export const ticketPackages = {
  general: {
    key: "general",
    kind: "ticket",
    name: "General Admission",
    priceCents: 2900,
    active: true
  },
  drink: {
    key: "drink",
    kind: "ticket",
    name: "Deck + Drink",
    priceCents: 3700,
    active: true
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
