import {
  addons,
  bookingFeeCents,
  cafeItems,
  childPriceCents,
  type AddonKey,
  type CafeItemKey,
  type TicketPackageKey,
  ticketPackages
} from "./catalog";

export type OrderLineKind = "ticket" | "addon" | "cafe" | "custom";
export type StaffRole = "admin" | "pos" | "viewer";

export type OrderLine = {
  kind: OrderLineKind;
  productKey?: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  metadata?: Record<string, string | number | boolean>;
};

export type CheckoutOrderInput = {
  packageKey: TicketPackageKey;
  adults: number;
  children?: number;
  addons?: Partial<Record<AddonKey, number>>;
  visitDate?: string;
  entryTime?: string;
  customerEmail?: string;
};

export type PosSaleInput = {
  actorRole: StaffRole;
  lines: Array<
    | { kind: "ticket"; packageKey: TicketPackageKey; quantity?: number }
    | { kind: "cafe"; itemKey: CafeItemKey; quantity?: number }
    | { kind: "custom"; name: string; amountCents: number; quantity?: number; reason: string }
  >;
  customerEmail?: string;
};

export type DraftTotals = {
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
};

export type CheckoutOrderDraft = DraftTotals & {
  channel: "online";
  status: "draft";
  lines: OrderLine[];
  visitDate?: string;
  entryTime?: string;
  customerEmail?: string;
};

export type PosSaleDraft = DraftTotals & {
  channel: "pos";
  status: "draft";
  lines: OrderLine[];
  customerEmail?: string;
};

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function addLine(lines: OrderLine[], line: Omit<OrderLine, "lineTotalCents">) {
  lines.push({
    ...line,
    lineTotalCents: line.unitAmountCents * line.quantity
  });
}

function totals(lines: OrderLine[], includeBookingFee: boolean): DraftTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const feeCents = includeBookingFee ? bookingFeeCents(subtotalCents) : 0;
  return {
    currency: "usd",
    subtotalCents,
    feeCents,
    totalCents: subtotalCents + feeCents
  };
}

export function createCheckoutOrderDraft(input: CheckoutOrderInput): CheckoutOrderDraft {
  const adults = input.adults;
  const children = input.children ?? 0;
  assertPositiveInteger(adults, "adults");
  assertNonNegativeInteger(children, "children");

  const ticket = ticketPackages[input.packageKey];
  if (!ticket || !ticket.active) {
    throw new Error("Ticket package is not bookable");
  }

  const lines: OrderLine[] = [];
  addLine(lines, {
    kind: "ticket",
    productKey: ticket.key,
    name: ticket.name,
    quantity: adults,
    unitAmountCents: ticket.priceCents
  });

  if (children > 0) {
    addLine(lines, {
      kind: "ticket",
      productKey: ticket.key,
      name: `${ticket.name} Child`,
      quantity: children,
      unitAmountCents: childPriceCents(ticket.priceCents),
      metadata: { childDiscountRate: 0.5 }
    });
  }

  for (const [addonKey, quantity = 0] of Object.entries(input.addons ?? {}) as Array<[AddonKey, number]>) {
    if (quantity === 0) continue;
    assertPositiveInteger(quantity, `${addonKey} quantity`);
    const addon = addons[addonKey];
    if (!addon || !addon.active) {
      throw new Error(`Addon is not bookable: ${addonKey}`);
    }
    addLine(lines, {
      kind: "addon",
      productKey: addon.key,
      name: addon.name,
      quantity,
      unitAmountCents: addon.priceCents
    });
  }

  return {
    channel: "online",
    status: "draft",
    ...totals(lines, true),
    lines,
    visitDate: input.visitDate,
    entryTime: input.entryTime,
    customerEmail: input.customerEmail?.trim().toLowerCase()
  };
}

export function createPosSaleDraft(input: PosSaleInput): PosSaleDraft {
  if (input.actorRole !== "admin" && input.actorRole !== "pos") {
    throw new Error("POS sale requires a pos or admin role");
  }
  if (!input.lines.length) {
    throw new Error("POS sale requires at least one line");
  }

  const lines: OrderLine[] = [];
  for (const inputLine of input.lines) {
    const quantity = inputLine.quantity ?? 1;
    assertPositiveInteger(quantity, "line quantity");

    if (inputLine.kind === "ticket") {
      const ticket = ticketPackages[inputLine.packageKey];
      if (!ticket || !ticket.active) {
        throw new Error("Ticket package is not sellable at POS");
      }
      addLine(lines, {
        kind: "ticket",
        productKey: ticket.key,
        name: ticket.name,
        quantity,
        unitAmountCents: ticket.priceCents
      });
      continue;
    }

    if (inputLine.kind === "cafe") {
      const item = cafeItems[inputLine.itemKey];
      if (!item || !item.active) {
        throw new Error("Cafe item is not sellable at POS");
      }
      addLine(lines, {
        kind: "cafe",
        productKey: item.key,
        name: item.name,
        quantity,
        unitAmountCents: item.priceCents
      });
      continue;
    }

    if (inputLine.kind === "custom") {
      assertPositiveInteger(inputLine.amountCents, "custom amountCents");
      if (inputLine.amountCents < 50) {
        throw new Error("Custom charge must be at least 50 cents");
      }
      if (!inputLine.reason.trim()) {
        throw new Error("Custom charge requires a reason");
      }
      addLine(lines, {
        kind: "custom",
        name: inputLine.name.trim() || "Custom charge",
        quantity,
        unitAmountCents: inputLine.amountCents,
        metadata: { reason: inputLine.reason.trim() }
      });
    }
  }

  return {
    channel: "pos",
    status: "draft",
    ...totals(lines, false),
    lines,
    customerEmail: input.customerEmail?.trim().toLowerCase()
  };
}
