import { addons, type AddonKey, type TicketPackageKey, ticketPackages } from "./catalog";

export type VoucherSource = "package" | "addon";

export type VoucherEntitlement = {
  id: string;
  label: string;
  quantity: number;
  redeemed: number;
  remaining: number;
  source: VoucherSource;
  packageKey?: string;
  addonKey?: string;
};

export type VoucherSummary = {
  total: number;
  redeemed: number;
  remaining: number;
};

export type VoucherRedemptionDelta = 1 | -1;

export type VoucherBuildInput = {
  packageKey?: string;
  adults?: number;
  children?: number;
  partySize?: number;
  packageQuantities?: Record<string, number | undefined>;
  addonQuantities?: Record<string, number | undefined>;
  addonLabels?: Record<string, string | undefined>;
  redemptionTotals?: Record<string, number | undefined>;
};

export type VoucherRedemptionProjection = {
  voucherId: string;
  label: string;
  fromRedeemed: number;
  toRedeemed: number;
  quantity: number;
};

type PackageVoucherRule = {
  label: string;
  quantity?: number;
  perGuest?: boolean;
};

const packageVoucherRules: Record<TicketPackageKey, readonly PackageVoucherRule[]> = {
  general: [],
  drink: [{ label: "Coffee or Matcha (your choice)", perGuest: true }],
  "date-night": [
    { label: "Champagne for Two", quantity: 1 },
    { label: "Charcuterie & Dessert", quantity: 1 },
    { label: "Reserved Window Seats", quantity: 1 },
    { label: "Keepsake Photo", quantity: 1 }
  ],
  "champagne-room": [
    { label: "Champagne Bottle Service", quantity: 1 },
    { label: "Caviar & Small Bites", quantity: 1 },
    { label: "Personal Host", quantity: 1 }
  ],
  "family-suite": [
    { label: "Private Suite", quantity: 1 },
    { label: "Dedicated Waitress", quantity: 1 },
    { label: "Family & Kids Menu", quantity: 1 }
  ]
};

function isTicketPackageKey(value: string): value is TicketPackageKey {
  return value in ticketPackages;
}

function isAddonKey(value: string): value is AddonKey {
  return value in addons;
}

function positiveInteger(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function nonNegativeInteger(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function addQuantity(target: Record<string, number>, key: string, quantity: number) {
  const normalized = positiveInteger(quantity);
  if (normalized > 0) {
    target[key] = (target[key] ?? 0) + normalized;
  }
}

function legacyPackageQuantity(input: VoucherBuildInput) {
  if (!input.packageKey || !isTicketPackageKey(input.packageKey)) {
    return {};
  }

  const adults = positiveInteger(input.adults);
  const children = positiveInteger(input.children);
  const partySize = positiveInteger(input.partySize);
  const guestCount = adults + children || partySize || 1;

  return {
    [input.packageKey]: packageVoucherRules[input.packageKey].some((rule) => rule.perGuest) ? guestCount : 1
  };
}

function normalizedRedemptionTotals(value: VoucherBuildInput["redemptionTotals"]) {
  const totals: Record<string, number> = {};
  for (const [id, quantity] of Object.entries(value ?? {})) {
    const normalized = nonNegativeInteger(quantity);
    if (normalized > 0) {
      totals[id] = normalized;
    }
  }
  return totals;
}

export function buildVoucherEntitlements(input: VoucherBuildInput): VoucherEntitlement[] {
  const packageQuantities: Record<string, number> = { ...legacyPackageQuantity(input) };
  for (const [key, quantity] of Object.entries(input.packageQuantities ?? {})) {
    addQuantity(packageQuantities, key, quantity ?? 0);
  }

  const addonQuantities: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(input.addonQuantities ?? {})) {
    addQuantity(addonQuantities, key, quantity ?? 0);
  }

  const redemptionTotals = normalizedRedemptionTotals(input.redemptionTotals);
  const entitlements: Array<Omit<VoucherEntitlement, "redeemed" | "remaining">> = [];

  for (const [packageKey, packageQuantity] of Object.entries(packageQuantities)) {
    if (!isTicketPackageKey(packageKey)) {
      continue;
    }

    packageVoucherRules[packageKey].forEach((rule, index) => {
      const quantity = rule.perGuest ? packageQuantity : packageQuantity * (rule.quantity ?? 1);
      if (quantity > 0) {
        entitlements.push({
          id: `pkg-${index}`,
          label: rule.label,
          quantity,
          source: "package",
          packageKey
        });
      }
    });
  }

  for (const [addonKey, quantity] of Object.entries(addonQuantities)) {
    const label = input.addonLabels?.[addonKey] ?? (isAddonKey(addonKey) ? addons[addonKey].name : addonKey);
    entitlements.push({
      id: `addon-${addonKey}`,
      label,
      quantity,
      source: "addon",
      addonKey
    });
  }

  return entitlements.map((entitlement) => {
    const redeemed = Math.min(redemptionTotals[entitlement.id] ?? 0, entitlement.quantity);
    return {
      ...entitlement,
      redeemed,
      remaining: entitlement.quantity - redeemed
    };
  });
}

export function summarizeVoucherEntitlements(entitlements: VoucherEntitlement[]): VoucherSummary {
  return entitlements.reduce(
    (summary, entitlement) => ({
      total: summary.total + entitlement.quantity,
      redeemed: summary.redeemed + entitlement.redeemed,
      remaining: summary.remaining + entitlement.remaining
    }),
    { total: 0, redeemed: 0, remaining: 0 }
  );
}

export function projectVoucherRedemption(
  entitlements: VoucherEntitlement[],
  voucherId: string,
  delta: VoucherRedemptionDelta
): VoucherRedemptionProjection {
  const entitlement = entitlements.find((item) => item.id === voucherId);
  if (!entitlement) {
    throw new Error("Voucher was not found for this booking");
  }

  const toRedeemed = entitlement.redeemed + delta;
  if (toRedeemed > entitlement.quantity) {
    throw new Error("Voucher is already fully redeemed");
  }
  if (toRedeemed < 0) {
    throw new Error("Voucher has no redemptions to undo");
  }

  return {
    voucherId,
    label: entitlement.label,
    fromRedeemed: entitlement.redeemed,
    toRedeemed,
    quantity: entitlement.quantity
  };
}
