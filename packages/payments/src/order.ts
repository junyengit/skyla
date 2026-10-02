import {
  addons,
  admissionAgeCategories,
  admissionLineName,
  admissionMaxPartySize,
  admissionMinAdults,
  admissionPolicyVersion,
  bookingFeeCents,
  cafeItems,
  catalogLineMetadata,
  type AddonKey,
  type AdmissionAgeCategory,
  type CafeItemKey,
  type TicketPackage,
  type TicketPackageKey,
  ticketPackages
} from "./catalog";

export type OrderLineKind = "ticket" | "addon" | "cafe" | "custom";
export type StaffRole = "admin" | "pos" | "viewer";

export const checkoutEntryTimes = [
  { value: "09:00", label: "9:00 AM" },
  { value: "09:30", label: "9:30 AM" },
  { value: "10:00", label: "10:00 AM" },
  { value: "10:30", label: "10:30 AM" },
  { value: "11:00", label: "11:00 AM" },
  { value: "11:30", label: "11:30 AM" },
  { value: "12:00", label: "12:00 PM" },
  { value: "12:30", label: "12:30 PM" },
  { value: "13:00", label: "1:00 PM" },
  { value: "13:30", label: "1:30 PM" },
  { value: "14:00", label: "2:00 PM" },
  { value: "14:30", label: "2:30 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "15:30", label: "3:30 PM" },
  { value: "16:00", label: "4:00 PM" },
  { value: "16:30", label: "4:30 PM" },
  { value: "17:00", label: "5:00 PM" },
  { value: "17:30", label: "5:30 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "18:30", label: "6:30 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "19:30", label: "7:30 PM" },
  { value: "20:00", label: "8:00 PM" },
  { value: "20:30", label: "8:30 PM" }
] as const;
export const checkoutBookingWindowDays = 365;

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
  /** Adults 18+, at the package price. */
  adults: number;
  /** Paid youths 8-17. Kept as `children` for API compatibility. */
  children?: number;
  /** Children 0-7, admitted free as a zero-priced ticket line. */
  freeChildren?: number;
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

export type AdmissionPartyCounts = {
  adults: number;
  children: number;
  freeChildren: number;
  partySize: number;
};

function assertAdmissionCount(value: unknown, label: string, min: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > admissionMaxPartySize) {
    throw new Error(`${label} must be a whole number from ${min} to ${admissionMaxPartySize}`);
  }
  return value;
}

export function admissionPartyCounts(input: {
  adults: unknown;
  children?: unknown;
  freeChildren?: unknown;
}): AdmissionPartyCounts {
  const adults = assertAdmissionCount(input.adults, "adults", admissionMinAdults);
  const children = assertAdmissionCount(input.children ?? 0, "children", 0);
  const freeChildren = assertAdmissionCount(input.freeChildren ?? 0, "freeChildren", 0);
  const partySize = adults + children + freeChildren;
  if (partySize > admissionMaxPartySize) {
    throw new Error(`party size must be ${admissionMaxPartySize} visitors or fewer`);
  }
  return { adults, children, freeChildren, partySize };
}

export function admissionLineMetadata(ticket: TicketPackage, category: AdmissionAgeCategory) {
  return {
    ...catalogLineMetadata(ticket),
    admissionPolicyVersion,
    ageCategory: category.key,
    ageRange: category.ageRange
  };
}

export function admissionUnitAmountCents(ticket: Pick<TicketPackage, "priceCents">, category: AdmissionAgeCategory) {
  return category.key === "adult" ? ticket.priceCents : category.priceCents;
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
  const party = admissionPartyCounts(input);

  const ticket: TicketPackage | undefined = ticketPackages[input.packageKey];
  if (!ticket || !ticket.active) {
    throw new Error("Ticket package is not bookable");
  }
  if (ticket.admissionPolicyVersion !== admissionPolicyVersion) {
    throw new Error("Ticket package has no confirmed admission age policy");
  }

  const lines: OrderLine[] = [];
  for (const category of Object.values(admissionAgeCategories)) {
    const quantity = party[category.partyField];
    if (quantity === 0) continue;
    addLine(lines, {
      kind: "ticket",
      productKey: ticket.key,
      name: admissionLineName(ticket, category),
      quantity,
      unitAmountCents: admissionUnitAmountCents(ticket, category),
      metadata: admissionLineMetadata(ticket, category)
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
      unitAmountCents: addon.priceCents,
      metadata: catalogLineMetadata(addon)
    });
  }

  return {
    channel: "online",
    status: "draft",
    // Owner decision: the advertised price is the charged price, so online
    // checkout carries no booking fee (California junk-fee law compliant).
    ...totals(lines, false),
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
        unitAmountCents: ticket.priceCents,
        metadata: catalogLineMetadata(ticket)
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
        unitAmountCents: item.priceCents,
        metadata: catalogLineMetadata(item)
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
