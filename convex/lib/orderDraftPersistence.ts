import {
  addons,
  cafeItems,
  catalogLineMetadata,
  childDiscountRate,
  childPriceCents,
  checkoutOrderLineRecords,
  checkoutOrderRecord,
  createCheckoutOrderDraft,
  createPosSaleDraft,
  posSaleLineRecords,
  posSaleRecord,
  ticketPackages,
  type CatalogPricedItem,
  type AddonKey,
  type CafeItemKey,
  type CheckoutOrderDraft,
  type PosSaleDraft,
  type PosSaleInput,
  type StaffRole,
  type StoredOrderLineRecord,
  type StoredOrderRecord,
  type StoredPosSaleLineRecord,
  type StoredPosSaleRecord,
  type TicketPackageKey
} from "@skyla/payments";

export type CheckoutDraftArgs = {
  packageKey: TicketPackageKey;
  adults: number;
  children?: number;
  addons?: Partial<Record<AddonKey, number>>;
  visitDate?: string;
  entryTime?: string;
  customerEmail?: string;
  source?: string;
  idempotencyKey: string;
};

export type PosSaleDraftArgs = {
  lines: PosSaleInput["lines"];
  customerEmail?: string;
  readerId?: string;
  terminalLocationId?: string;
  idempotencyKey: string;
};

export type NormalizedCheckoutDraftArgs = CheckoutDraftArgs;
export type NormalizedPosSaleDraftArgs = PosSaleDraftArgs;

export type BuiltCheckoutDraftWrite = {
  input: NormalizedCheckoutDraftArgs;
  draft: CheckoutOrderDraft;
  draftFingerprint: string;
  order: StoredOrderRecord;
  lines: StoredOrderLineRecord[];
};

export type BuiltPosSaleDraftWrite<StaffUserId extends string = string> = {
  input: NormalizedPosSaleDraftArgs;
  draft: PosSaleDraft;
  draftFingerprint: string;
  sale: StoredPosSaleRecord<StaffUserId>;
  lines: StoredPosSaleLineRecord[];
};

type Jsonish = string | number | boolean | null | Jsonish[] | { [key: string]: Jsonish | undefined };
type DraftResultLine = {
  name: string;
  kind: string;
  productKey?: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  metadata?: Record<string, string | number | boolean>;
};
type CheckoutDraftResultOrder = {
  orderRef: string;
  status: string;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  visitDate?: string;
  entryTime?: string;
  customerEmailLower?: string;
};
type PosSaleDraftResultSale = {
  saleRef: string;
  status: string;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  customerEmailLower?: string;
  readerId?: string;
  terminalLocationId?: string;
};

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertIntegerRange(value: number, label: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
}

function optionalTrimmed(value: string | undefined, label: string, maxLength: number) {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

export function normalizeIdempotencyKey(value: string) {
  const key = value.trim();
  if (!idempotencyKeyPattern.test(key)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return key;
}

function normalizeEmail(value: string | undefined) {
  const email = optionalTrimmed(value, "customerEmail", 254)?.toLowerCase();
  if (email && !emailPattern.test(email)) {
    throw new Error("customerEmail must be a valid email address");
  }
  return email;
}

function normalizeVisitDate(value: string | undefined) {
  const visitDate = optionalTrimmed(value, "visitDate", 10);
  if (!visitDate) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    throw new Error("visitDate must use YYYY-MM-DD");
  }
  const date = new Date(`${visitDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== visitDate) {
    throw new Error("visitDate must be a real calendar date");
  }
  return visitDate;
}

function normalizeEntryTime(value: string | undefined) {
  const entryTime = optionalTrimmed(value, "entryTime", 5);
  if (entryTime && !timePattern.test(entryTime)) {
    throw new Error("entryTime must use HH:mm");
  }
  return entryTime;
}

function normalizeCheckoutAddons(value: Partial<Record<AddonKey, number>> | undefined) {
  const normalized: Partial<Record<AddonKey, number>> = {};

  for (const addonKey of Object.keys(addons) as AddonKey[]) {
    const quantity = value?.[addonKey] ?? 0;
    assertIntegerRange(quantity, `${addonKey} quantity`, 0, 20);
    if (quantity > 0) {
      normalized[addonKey] = quantity;
    }
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeSource(value: string | undefined) {
  return optionalTrimmed(value, "source", 80);
}

function normalizeReaderValue(value: string | undefined, label: string) {
  return optionalTrimmed(value, label, 120);
}

export function normalizeCheckoutDraftArgs(args: CheckoutDraftArgs): NormalizedCheckoutDraftArgs {
  if (!(args.packageKey in ticketPackages)) {
    throw new Error("packageKey is not recognized");
  }
  assertIntegerRange(args.adults, "adults", 1, 20);
  const children = args.children ?? 0;
  assertIntegerRange(children, "children", 0, 20);

  return withoutUndefined({
    packageKey: args.packageKey,
    adults: args.adults,
    children: children > 0 ? children : undefined,
    addons: normalizeCheckoutAddons(args.addons),
    visitDate: normalizeVisitDate(args.visitDate),
    entryTime: normalizeEntryTime(args.entryTime),
    customerEmail: normalizeEmail(args.customerEmail),
    source: normalizeSource(args.source),
    idempotencyKey: normalizeIdempotencyKey(args.idempotencyKey)
  });
}

function normalizePosLine(line: PosSaleInput["lines"][number]): PosSaleInput["lines"][number] {
  const quantity = line.quantity ?? 1;
  assertIntegerRange(quantity, "line quantity", 1, 99);

  if (line.kind === "ticket") {
    if (!(line.packageKey in ticketPackages)) {
      throw new Error("packageKey is not recognized");
    }
    return { kind: "ticket", packageKey: line.packageKey, quantity };
  }

  if (line.kind === "cafe") {
    if (!(line.itemKey in cafeItems)) {
      throw new Error("itemKey is not recognized");
    }
    return { kind: "cafe", itemKey: line.itemKey, quantity };
  }

  assertIntegerRange(line.amountCents, "custom amountCents", 50, 100000);
  const name = optionalTrimmed(line.name, "custom name", 80) ?? "Custom charge";
  const reason = optionalTrimmed(line.reason, "custom reason", 160);
  if (!reason) {
    throw new Error("Custom charge requires a reason");
  }
  return {
    kind: "custom",
    name,
    amountCents: line.amountCents,
    quantity,
    reason
  };
}

export function normalizePosSaleDraftArgs(args: PosSaleDraftArgs): NormalizedPosSaleDraftArgs {
  if (!Array.isArray(args.lines) || args.lines.length === 0) {
    throw new Error("POS sale requires at least one line");
  }
  if (args.lines.length > 100) {
    throw new Error("POS sale can include at most 100 lines");
  }

  return withoutUndefined({
    lines: args.lines.map(normalizePosLine),
    customerEmail: normalizeEmail(args.customerEmail),
    readerId: normalizeReaderValue(args.readerId, "readerId"),
    terminalLocationId: normalizeReaderValue(args.terminalLocationId, "terminalLocationId"),
    idempotencyKey: normalizeIdempotencyKey(args.idempotencyKey)
  });
}

function stableJson(value: Jsonish): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] as Jsonish)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactFingerprint(value: Jsonish) {
  return `v1:${stableJson(value)}`;
}

export function checkoutDraftFingerprint(input: NormalizedCheckoutDraftArgs) {
  return exactFingerprint({
    packageKey: input.packageKey,
    adults: input.adults,
    children: input.children,
    addons: input.addons,
    visitDate: input.visitDate,
    entryTime: input.entryTime,
    customerEmail: input.customerEmail
  });
}

export function posSaleDraftFingerprint(input: NormalizedPosSaleDraftArgs, actorRole: StaffRole) {
  return exactFingerprint({
    actorRole,
    lines: input.lines,
    customerEmail: input.customerEmail,
    readerId: input.readerId,
    terminalLocationId: input.terminalLocationId
  });
}

export function buildCheckoutDraftWrite(
  args: CheckoutDraftArgs,
  options: { orderRef: string; now: number }
): BuiltCheckoutDraftWrite {
  const input = normalizeCheckoutDraftArgs(args);
  const draft = createCheckoutOrderDraft(input);
  const draftFingerprint = checkoutDraftFingerprint(input);

  return {
    input,
    draft,
    draftFingerprint,
    order: checkoutOrderRecord(draft, {
      orderRef: options.orderRef,
      now: options.now,
      source: input.source ?? "convex",
      idempotencyKey: input.idempotencyKey,
      draftFingerprint
    }),
    lines: checkoutOrderLineRecords(options.orderRef, draft.lines)
  };
}

export function buildPosSaleDraftWrite<StaffUserId extends string>(
  args: PosSaleDraftArgs,
  options: { saleRef: string; now: number; staffUserId: StaffUserId; actorRole: StaffRole }
): BuiltPosSaleDraftWrite<StaffUserId> {
  const input = normalizePosSaleDraftArgs(args);
  const draft = createPosSaleDraft({
    actorRole: options.actorRole,
    lines: input.lines,
    customerEmail: input.customerEmail
  });
  const draftFingerprint = posSaleDraftFingerprint(input, options.actorRole);

  return {
    input,
    draft,
    draftFingerprint,
    sale: posSaleRecord(draft, {
      saleRef: options.saleRef,
      now: options.now,
      staffUserId: options.staffUserId,
      readerId: input.readerId,
      terminalLocationId: input.terminalLocationId,
      idempotencyKey: input.idempotencyKey,
      draftFingerprint
    }),
    lines: posSaleLineRecords(options.saleRef, draft.lines)
  };
}

export function assertSameDraftFingerprint(existingFingerprint: string | undefined, nextFingerprint: string) {
  if (existingFingerprint !== nextFingerprint) {
    throw new Error("idempotencyKey was already used for a different draft");
  }
}

export function checkoutDraftResult(order: CheckoutDraftResultOrder, lines: DraftResultLine[]) {
  return withoutUndefined({
    orderRef: order.orderRef,
    status: order.status,
    totals: {
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      feeCents: order.feeCents,
      totalCents: order.totalCents
    },
    visitDate: order.visitDate,
    entryTime: order.entryTime,
    customerEmail: order.customerEmailLower,
    lines: lines.map(draftLineResult)
  });
}

export function posSaleDraftResult(sale: PosSaleDraftResultSale, lines: DraftResultLine[]) {
  return withoutUndefined({
    saleRef: sale.saleRef,
    status: sale.status,
    totals: {
      currency: sale.currency,
      subtotalCents: sale.subtotalCents,
      feeCents: sale.feeCents,
      totalCents: sale.totalCents
    },
    customerEmail: sale.customerEmailLower,
    readerId: sale.readerId,
    terminalLocationId: sale.terminalLocationId,
    lines: lines.map(draftLineResult)
  });
}

function draftLineResult(line: DraftResultLine) {
  return withoutUndefined({
    kind: line.kind,
    productKey: line.productKey,
    name: line.name,
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    lineTotalCents: line.lineTotalCents,
    metadata: line.metadata
  });
}

export function assertStoredPaymentLineProvenance(lines: DraftResultLine[], label: string) {
  if (!lines.length) {
    throw new Error(`${label} payment requires stored line items`);
  }

  for (const [index, line] of lines.entries()) {
    const lineLabel = `${label} line ${index + 1}`;
    if (line.kind === "custom") {
      assertCustomLineMetadata(line, lineLabel);
      continue;
    }

    const item = catalogItemForLine(line, lineLabel);
    const metadata = assertMetadata(line.metadata, lineLabel);
    const expectedMetadata = catalogLineMetadata(item);

    for (const [key, value] of Object.entries(expectedMetadata)) {
      if (metadata[key] !== value) {
        throw new Error(`${lineLabel} has mismatched catalog provenance: ${key}`);
      }
    }

    assertCatalogLineAmount(line, item, metadata, lineLabel);
  }
}

function catalogItemForLine(line: DraftResultLine, lineLabel: string): CatalogPricedItem {
  if (!line.productKey) {
    throw new Error(`${lineLabel} is missing a productKey`);
  }

  if (line.kind === "ticket" && line.productKey in ticketPackages) {
    return ticketPackages[line.productKey as TicketPackageKey];
  }
  if (line.kind === "addon" && line.productKey in addons) {
    return addons[line.productKey as AddonKey];
  }
  if (line.kind === "cafe" && line.productKey in cafeItems) {
    return cafeItems[line.productKey as CafeItemKey];
  }

  throw new Error(`${lineLabel} references an unknown code-owned catalog item`);
}

function assertMetadata(
  metadata: DraftResultLine["metadata"],
  lineLabel: string
): Record<string, string | number | boolean> {
  if (!metadata || typeof metadata !== "object") {
    throw new Error(`${lineLabel} is missing catalog provenance metadata`);
  }
  return metadata;
}

function assertCatalogLineAmount(
  line: DraftResultLine,
  item: CatalogPricedItem,
  metadata: Record<string, string | number | boolean>,
  lineLabel: string
) {
  const isChildTicket = line.kind === "ticket" && metadata.childDiscountRate === childDiscountRate;
  if (line.kind !== "ticket" && metadata.childDiscountRate !== undefined) {
    throw new Error(`${lineLabel} has child pricing metadata on a non-ticket line`);
  }

  const expectedName = isChildTicket ? `${item.name} Child` : item.name;
  const expectedUnitAmountCents = isChildTicket ? childPriceCents(item.priceCents) : item.priceCents;

  if (line.name !== expectedName) {
    throw new Error(`${lineLabel} name does not match the code-owned catalog`);
  }
  if (line.unitAmountCents !== expectedUnitAmountCents) {
    throw new Error(`${lineLabel} price does not match the code-owned catalog`);
  }
  if (line.quantity * line.unitAmountCents !== line.lineTotalCents) {
    throw new Error(`${lineLabel} total is inconsistent with quantity and unit price`);
  }
}

function assertCustomLineMetadata(line: DraftResultLine, lineLabel: string) {
  const metadata = line.metadata ?? {};
  if (
    metadata.catalogVersion !== undefined ||
    metadata.catalogSource !== undefined ||
    metadata.catalogAuthority !== undefined ||
    metadata.catalogContentHash !== undefined
  ) {
    throw new Error(`${lineLabel} is custom but includes catalog provenance metadata`);
  }

  if (typeof metadata.reason !== "string" || !metadata.reason.trim()) {
    throw new Error(`${lineLabel} is custom and requires a stored reason`);
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
