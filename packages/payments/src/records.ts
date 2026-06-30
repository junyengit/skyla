import type { CheckoutOrderDraft, OrderLine, PosSaleDraft } from "./order";

export type StoredOrderRecord = {
  orderRef: string;
  channel: "online";
  status: "draft";
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  customerEmailLower?: string;
  visitDate?: string;
  entryTime?: string;
  source?: string;
  idempotencyKey?: string;
  draftFingerprint?: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredOrderLineRecord = {
  orderRef: string;
  kind: OrderLine["kind"];
  productKey?: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  metadata?: OrderLine["metadata"];
};

export type StoredPosSaleRecord<StaffUserId extends string = string> = {
  saleRef: string;
  status: "draft";
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  staffUserId?: StaffUserId;
  customerEmailLower?: string;
  readerId?: string;
  terminalLocationId?: string;
  idempotencyKey?: string;
  draftFingerprint?: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredPosSaleLineRecord = Omit<StoredOrderLineRecord, "orderRef"> & {
  saleRef: string;
};

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function refSuffixFromId(id: string) {
  const clean = id.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return clean.padEnd(6, "0").slice(-6);
}

function dateParts(now: number) {
  const date = new Date(now);
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return { year, month, day };
}

export function orderRefFromId(id: string, now = Date.now()) {
  const { year, month } = dateParts(now);
  return `SKY${year}${month}-${refSuffixFromId(id)}`;
}

export function saleRefFromId(id: string, now = Date.now()) {
  const { year, month, day } = dateParts(now);
  return `SALE${year}${month}${day}-${refSuffixFromId(id)}`;
}

export function checkoutOrderRecord(
  draft: CheckoutOrderDraft,
  options: { orderRef: string; now: number; source?: string; idempotencyKey?: string; draftFingerprint?: string }
): StoredOrderRecord {
  return stripUndefined({
    orderRef: options.orderRef,
    channel: draft.channel,
    status: draft.status,
    currency: draft.currency,
    subtotalCents: draft.subtotalCents,
    feeCents: draft.feeCents,
    totalCents: draft.totalCents,
    customerEmailLower: draft.customerEmail,
    visitDate: draft.visitDate,
    entryTime: draft.entryTime,
    source: options.source,
    idempotencyKey: options.idempotencyKey,
    draftFingerprint: options.draftFingerprint,
    createdAt: options.now,
    updatedAt: options.now
  });
}

export function checkoutOrderLineRecords(orderRef: string, lines: OrderLine[]): StoredOrderLineRecord[] {
  return lines.map((line) =>
    stripUndefined({
      orderRef,
      kind: line.kind,
      productKey: line.productKey,
      name: line.name,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      lineTotalCents: line.lineTotalCents,
      metadata: line.metadata
    })
  );
}

export function posSaleRecord<StaffUserId extends string>(
  draft: PosSaleDraft,
  options: {
    saleRef: string;
    now: number;
    staffUserId?: StaffUserId;
    readerId?: string;
    terminalLocationId?: string;
    idempotencyKey?: string;
    draftFingerprint?: string;
  }
): StoredPosSaleRecord<StaffUserId> {
  return stripUndefined({
    saleRef: options.saleRef,
    status: draft.status,
    currency: draft.currency,
    subtotalCents: draft.subtotalCents,
    feeCents: draft.feeCents,
    totalCents: draft.totalCents,
    staffUserId: options.staffUserId,
    customerEmailLower: draft.customerEmail,
    readerId: options.readerId,
    terminalLocationId: options.terminalLocationId,
    idempotencyKey: options.idempotencyKey,
    draftFingerprint: options.draftFingerprint,
    createdAt: options.now,
    updatedAt: options.now
  });
}

export function posSaleLineRecords(saleRef: string, lines: OrderLine[]): StoredPosSaleLineRecord[] {
  return lines.map((line) =>
    stripUndefined({
      saleRef,
      kind: line.kind,
      productKey: line.productKey,
      name: line.name,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      lineTotalCents: line.lineTotalCents,
      metadata: line.metadata
    })
  );
}
