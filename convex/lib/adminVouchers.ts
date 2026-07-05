import {
  buildVoucherEntitlements,
  summarizeVoucherEntitlements,
  type VoucherEntitlement,
  type VoucherSummary
} from "@skyla/payments";

export type AdminVoucherOrderLine = {
  kind: string;
  productKey?: string;
  name: string;
  quantity: number;
};

export type AdminVoucherBooking = {
  rawLegacy?: unknown;
  partySize?: number;
};

export type AdminVoucherEvent = {
  voucherId: string;
  delta: 1 | -1;
};

export type AdminBookingVouchers = {
  items: VoucherEntitlement[];
  summary: VoucherSummary;
};

function legacyString(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return undefined;
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function legacyNumber(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return undefined;
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function positiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function numberRecord(rawLegacy: unknown, key: string) {
  if (!rawLegacy || typeof rawLegacy !== "object" || Array.isArray(rawLegacy)) {
    return {};
  }
  const value = (rawLegacy as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, number> = {};
  for (const [recordKey, recordValue] of Object.entries(value)) {
    const quantity = positiveInteger(recordValue);
    if (quantity > 0) {
      record[recordKey] = quantity;
    }
  }
  return record;
}

function orderLineVoucherInput(orderLines: AdminVoucherOrderLine[]) {
  const packageQuantities: Record<string, number> = {};
  const addonQuantities: Record<string, number> = {};
  const addonLabels: Record<string, string> = {};

  for (const line of orderLines) {
    if (!line.productKey) {
      continue;
    }
    const quantity = positiveInteger(line.quantity);
    if (quantity <= 0) {
      continue;
    }
    if (line.kind === "ticket") {
      packageQuantities[line.productKey] = (packageQuantities[line.productKey] ?? 0) + quantity;
    }
    if (line.kind === "addon") {
      addonQuantities[line.productKey] = (addonQuantities[line.productKey] ?? 0) + quantity;
      addonLabels[line.productKey] = line.name;
    }
  }

  return { packageQuantities, addonQuantities, addonLabels };
}

export function voucherRedemptionTotals(rawLegacy: unknown, events: AdminVoucherEvent[]) {
  const totals = numberRecord(rawLegacy, "redemptions");
  for (const event of events) {
    totals[event.voucherId] = Math.max(0, (totals[event.voucherId] ?? 0) + event.delta);
    if (totals[event.voucherId] === 0) {
      delete totals[event.voucherId];
    }
  }
  return totals;
}

export function buildAdminBookingVouchers(
  booking: AdminVoucherBooking,
  orderLines: AdminVoucherOrderLine[],
  events: AdminVoucherEvent[]
): AdminBookingVouchers {
  const hasNativeOrderLines = orderLines.length > 0;
  const orderLineInput = orderLineVoucherInput(orderLines);
  const items = buildVoucherEntitlements({
    packageKey: hasNativeOrderLines ? undefined : legacyString(booking.rawLegacy, "packageKey"),
    adults: hasNativeOrderLines ? undefined : legacyNumber(booking.rawLegacy, "adults"),
    children: hasNativeOrderLines ? undefined : legacyNumber(booking.rawLegacy, "children"),
    partySize: hasNativeOrderLines ? undefined : booking.partySize ?? legacyNumber(booking.rawLegacy, "partySize"),
    packageQuantities: hasNativeOrderLines ? orderLineInput.packageQuantities : undefined,
    addonQuantities: hasNativeOrderLines ? orderLineInput.addonQuantities : numberRecord(booking.rawLegacy, "addons"),
    addonLabels: hasNativeOrderLines ? orderLineInput.addonLabels : undefined,
    redemptionTotals: voucherRedemptionTotals(booking.rawLegacy, events)
  });

  return {
    items,
    summary: summarizeVoucherEntitlements(items)
  };
}
