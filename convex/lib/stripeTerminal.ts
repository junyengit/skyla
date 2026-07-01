import { stripeApiBaseUrl, stripeApiVersion } from "./stripeCheckout";

const maxStripeDescriptionLength = 120;

export { stripeApiBaseUrl, stripeApiVersion };

export type StripeTerminalLine = {
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
};

export type StripeTerminalSnapshot = {
  saleRef: string;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  customerEmailLower?: string;
  readerId?: string;
  terminalLocationId?: string;
  lines: StripeTerminalLine[];
};

export type StripeTerminalIntentRequest = {
  endpoint: "/payment_intents";
  apiVersion: typeof stripeApiVersion;
  idempotencyKey: string;
  body: URLSearchParams;
};

export type StripeTerminalPaymentIntentResponse = {
  id?: string;
  object?: string;
  amount?: number;
  currency?: string;
  status?: string;
  client_secret?: string;
  metadata?: Record<string, string>;
  error?: {
    message?: string;
    type?: string;
  };
  [key: string]: unknown;
};

export function stripeTerminalIntentIdempotencyKey(saleRef: string) {
  const ref = saleRef.trim();
  if (!ref) {
    throw new Error("saleRef is required");
  }
  return `skyla:terminal-intent:${ref}`;
}

export function buildStripeTerminalPaymentIntentRequest(
  snapshot: StripeTerminalSnapshot
): StripeTerminalIntentRequest {
  assertStripeTerminalSnapshot(snapshot);

  const params = new URLSearchParams();
  params.set("amount", String(snapshot.totalCents));
  params.set("currency", snapshot.currency);
  params.set("payment_method_types[]", "card_present");
  params.set("capture_method", "automatic");
  params.set("description", terminalDescription(snapshot.saleRef));
  params.set("metadata[sale_ref]", snapshot.saleRef);
  params.set("metadata[source]", "convex-terminal");
  params.set("metadata[line_count]", String(snapshot.lines.length));
  if (snapshot.customerEmailLower) {
    params.set("receipt_email", snapshot.customerEmailLower);
  }
  if (snapshot.readerId) {
    params.set("metadata[reader_id]", snapshot.readerId);
  }
  if (snapshot.terminalLocationId) {
    params.set("metadata[terminal_location_id]", snapshot.terminalLocationId);
  }

  return {
    endpoint: "/payment_intents",
    apiVersion: stripeApiVersion,
    idempotencyKey: stripeTerminalIntentIdempotencyKey(snapshot.saleRef),
    body: params
  };
}

export function assertStripeTerminalSnapshot(snapshot: StripeTerminalSnapshot) {
  if (snapshot.currency !== "usd") {
    throw new Error("Stripe Terminal currently supports USD POS sales only");
  }
  if (!Number.isInteger(snapshot.totalCents) || snapshot.totalCents < 50) {
    throw new Error("Stripe Terminal total must be at least 50 cents");
  }
  if (snapshot.feeCents !== 0) {
    throw new Error("Stripe Terminal POS sales do not support booking fees");
  }
  if (!snapshot.lines.length) {
    throw new Error("Stripe Terminal requires at least one stored sale line");
  }

  const subtotalCents = snapshot.lines.reduce((sum, line) => sum + normalizeLine(line).lineTotalCents, 0);
  if (subtotalCents !== snapshot.subtotalCents) {
    throw new Error("Stored POS sale lines do not match sale subtotal");
  }
  if (snapshot.subtotalCents !== snapshot.totalCents) {
    throw new Error("Stored POS sale subtotal does not match sale total");
  }
}

export function stripeTerminalErrorMessage(data: StripeTerminalPaymentIntentResponse) {
  return data.error?.message ?? "Stripe Terminal PaymentIntent request failed";
}

export function sanitizeStripeTerminalPaymentIntent(data: StripeTerminalPaymentIntentResponse) {
  return withoutUndefined({
    id: stringValue(data.id),
    object: stringValue(data.object),
    status: stringValue(data.status),
    amount: numberValue(data.amount),
    currency: stringValue(data.currency),
    metadata: data.metadata
  });
}

function normalizeLine(line: StripeTerminalLine) {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new Error("Stripe Terminal line quantity must be a positive integer");
  }
  if (!Number.isInteger(line.unitAmountCents) || line.unitAmountCents < 50) {
    throw new Error("Stripe Terminal line unit amount must be at least 50 cents");
  }
  if (line.quantity * line.unitAmountCents !== line.lineTotalCents) {
    throw new Error("Stripe Terminal line total is inconsistent");
  }

  return line;
}

function terminalDescription(saleRef: string) {
  return `Sky LA POS ${saleRef}`.slice(0, maxStripeDescriptionLength);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
