import { stripeApiBaseUrl, stripeApiVersion } from "./stripeCheckout";
import type { StripeMode } from "./stripeMode";

const maxStripeDescriptionLength = 120;

export { stripeApiBaseUrl, stripeApiVersion };
export const terminalIntentSource = "convex-terminal";

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
  /** Selected LA visit and all-age party, present only with admission lines. */
  visitDate?: string;
  entryTime?: string;
  partySize?: number;
  lines: StripeTerminalLine[];
};

export type StripeTerminalIntentRequest = {
  endpoint: "/payment_intents";
  apiVersion: typeof stripeApiVersion;
  idempotencyKey: string;
  body: URLSearchParams;
};

export type StripeTerminalProcessSnapshot = {
  saleRef: string;
  paymentIntentId: string;
  readerId: string;
  amountCents: number;
  currency: "usd";
};

export type StripeTerminalProcessRequestSnapshot = StripeTerminalProcessSnapshot & {
  processAttempt: number;
};

export type StripeTerminalReaderProcessRequest = {
  endpoint: string;
  apiVersion: typeof stripeApiVersion;
  idempotencyKey: string;
  body: URLSearchParams;
};

export type StripeTerminalPaymentIntentResponse = {
  id?: string;
  object?: string;
  amount?: number;
  amount_received?: number;
  currency?: string;
  status?: string;
  livemode?: boolean;
  capture_method?: string;
  payment_method_types?: unknown;
  latest_charge?: unknown;
  last_payment_error?: { code?: string; decline_code?: string; message?: string } | null;
  client_secret?: string;
  metadata?: Record<string, string>;
  error?: {
    message?: string;
    type?: string;
  };
  [key: string]: unknown;
};

export type StripeTerminalReaderAction = {
  type?: string;
  status?: string;
  failure_code?: string | null;
  failure_message?: string | null;
  process_payment_intent?: {
    payment_intent?: string;
    process_config?: {
      enable_customer_cancellation?: boolean;
    };
  };
  [key: string]: unknown;
};

export type StripeTerminalReaderProcessResponse = {
  id?: string;
  object?: string;
  status?: string;
  location?: string;
  action?: StripeTerminalReaderAction | null;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  [key: string]: unknown;
};

/** Key used before frozen attempts; only read for legacy correlation. */
export function stripeTerminalIntentIdempotencyKey(saleRef: string) {
  const ref = saleRef.trim();
  if (!ref) {
    throw new Error("saleRef is required");
  }
  return `skyla:terminal-intent:${ref}`;
}

/** One key per frozen attempt; a replay always sends the stored body with it. */
export function stripeTerminalAttemptIdempotencyKey(saleRef: string, attemptNonce: string) {
  const ref = saleRef.trim();
  if (!ref) {
    throw new Error("saleRef is required");
  }
  if (!/^[a-f0-9]{32}$/.test(attemptNonce)) {
    throw new Error("attemptNonce must be 32 lowercase hex characters");
  }
  return `skyla:terminal-intent:v2:${ref}:${attemptNonce}`;
}

export function stripeTerminalProcessIdempotencyKey(
  saleRef: string,
  paymentIntentId: string,
  readerId: string,
  processAttempt: number
) {
  const ref = saleRef.trim();
  const intent = paymentIntentId.trim();
  const reader = readerId.trim();
  if (!ref) {
    throw new Error("saleRef is required");
  }
  if (!intent) {
    throw new Error("paymentIntentId is required");
  }
  if (!reader) {
    throw new Error("readerId is required");
  }
  if (!Number.isInteger(processAttempt) || processAttempt < 1) {
    throw new Error("processAttempt must be a positive integer");
  }
  return `skyla:terminal-process:${ref}:${intent}:${reader}:attempt-${processAttempt}`;
}

/**
 * The exact PaymentIntent request for one frozen attempt. It is stored before
 * the first POST and replayed byte-for-byte with the same key; it is never
 * rebuilt for a retry.
 */
export function buildStripeTerminalPaymentIntentRequest(
  snapshot: StripeTerminalSnapshot,
  options: { attemptNonce: string }
): StripeTerminalIntentRequest {
  assertStripeTerminalSnapshot(snapshot);

  const params = new URLSearchParams();
  params.set("amount", String(snapshot.totalCents));
  params.set("currency", snapshot.currency);
  params.set("payment_method_types[]", "card_present");
  params.set("capture_method", "automatic");
  params.set("description", terminalDescription(snapshot.saleRef));
  params.set("metadata[sale_ref]", snapshot.saleRef);
  params.set("metadata[source]", terminalIntentSource);
  params.set("metadata[attempt_nonce]", options.attemptNonce);
  params.set("metadata[line_count]", String(snapshot.lines.length));
  if (snapshot.visitDate && snapshot.entryTime && snapshot.partySize) {
    params.set("metadata[visit_date]", snapshot.visitDate);
    params.set("metadata[entry_time]", snapshot.entryTime);
    params.set("metadata[party_size]", String(snapshot.partySize));
  }
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
    idempotencyKey: stripeTerminalAttemptIdempotencyKey(snapshot.saleRef, options.attemptNonce),
    body: params
  };
}

export function buildStripeTerminalReaderProcessRequest(
  snapshot: StripeTerminalProcessRequestSnapshot
): StripeTerminalReaderProcessRequest {
  assertStripeTerminalProcessSnapshot(snapshot);

  const params = new URLSearchParams();
  params.set("payment_intent", snapshot.paymentIntentId);
  params.set("process_config[enable_customer_cancellation]", "true");

  return {
    endpoint: `/terminal/readers/${encodeURIComponent(snapshot.readerId)}/process_payment_intent`,
    apiVersion: stripeApiVersion,
    idempotencyKey: stripeTerminalProcessIdempotencyKey(
      snapshot.saleRef,
      snapshot.paymentIntentId,
      snapshot.readerId,
      snapshot.processAttempt
    ),
    body: params
  };
}

export function assertStripeTerminalSnapshot(snapshot: StripeTerminalSnapshot) {
  if (snapshot.currency !== "usd") {
    throw new Error("Stripe Terminal currently supports USD POS sales only");
  }
  if (!Number.isSafeInteger(snapshot.totalCents) || snapshot.totalCents < 50) {
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

export function assertStripeTerminalProcessSnapshot(snapshot: StripeTerminalProcessRequestSnapshot) {
  if (snapshot.currency !== "usd") {
    throw new Error("Stripe Terminal reader processing supports USD POS sales only");
  }
  if (!Number.isInteger(snapshot.amountCents) || snapshot.amountCents < 50) {
    throw new Error("Stripe Terminal reader processing amount must be at least 50 cents");
  }
  if (!snapshot.paymentIntentId.trim()) {
    throw new Error("Stripe Terminal PaymentIntent id is required");
  }
  if (!snapshot.readerId.trim()) {
    throw new Error("Stripe Terminal reader id is required");
  }
  if (!/^tmr_[A-Za-z0-9_]+$/.test(snapshot.readerId.trim())) {
    throw new Error("Stripe Terminal reader id must look like tmr_...");
  }
  if (!Number.isInteger(snapshot.processAttempt) || snapshot.processAttempt < 1) {
    throw new Error("Stripe Terminal reader process attempt must be a positive integer");
  }
}

export function stripeTerminalErrorMessage(data: StripeTerminalPaymentIntentResponse) {
  return data.error?.message ?? "Stripe Terminal PaymentIntent request failed";
}

export function stripeTerminalReaderErrorMessage(data: StripeTerminalReaderProcessResponse) {
  return data.error?.message ?? "Stripe Terminal reader process request failed";
}

export function sanitizeStripeTerminalPaymentIntent(data: StripeTerminalPaymentIntentResponse) {
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  return withoutUndefined({
    id: stringValue(data.id),
    object: stringValue(data.object),
    status: stringValue(data.status),
    amount: numberValue(data.amount),
    amount_received: numberValue(data.amount_received),
    currency: stringValue(data.currency),
    livemode: booleanValue(data.livemode),
    latest_charge: stringValue(data.latest_charge),
    decline_code: stringValue(data.last_payment_error?.decline_code ?? data.last_payment_error?.code),
    // Known correlation fields only; never the receipt email or client secret.
    metadata: withoutUndefined({
      sale_ref: stringValue(metadata.sale_ref),
      source: stringValue(metadata.source),
      attempt_nonce: stringValue(metadata.attempt_nonce),
      reader_id: stringValue(metadata.reader_id),
      visit_date: stringValue(metadata.visit_date),
      entry_time: stringValue(metadata.entry_time),
      party_size: stringValue(metadata.party_size)
    })
  });
}

export function sanitizeStripeTerminalReaderProcess(data: StripeTerminalReaderProcessResponse) {
  const action = data.action ?? undefined;
  return withoutUndefined({
    id: stringValue(data.id),
    object: stringValue(data.object),
    status: stringValue(data.status),
    location: stringValue(data.location),
    action: action
      ? withoutUndefined({
          type: stringValue(action.type),
          status: stringValue(action.status),
          failure_code: stringValue(action.failure_code),
          failure_message: stringValue(action.failure_message),
          payment_intent: stringValue(action.process_payment_intent?.payment_intent),
          customer_cancellation: booleanValue(
            action.process_payment_intent?.process_config?.enable_customer_cancellation
          )
        })
      : undefined
  });
}

export function stripeTerminalReaderPaymentStatus(data: StripeTerminalReaderProcessResponse) {
  if (data.action?.status === "failed") {
    return "failed" as const;
  }
  return "processing" as const;
}

export function stripeTerminalReaderPaymentIntentId(data: StripeTerminalReaderProcessResponse) {
  return stringValue(data.action?.process_payment_intent?.payment_intent);
}

export function assertStripeTerminalReaderProcessResult(
  data: StripeTerminalReaderProcessResponse,
  expectedPaymentIntentId: string
) {
  if (data.action?.type !== "process_payment_intent") {
    throw new Error("Stripe reader did not start a PaymentIntent process action");
  }
  const paymentIntentId = stripeTerminalReaderPaymentIntentId(data);
  if (!paymentIntentId) {
    throw new Error("Stripe reader did not echo the PaymentIntent being processed");
  }
  if (paymentIntentId !== expectedPaymentIntentId) {
    throw new Error("Stripe reader returned a different PaymentIntent");
  }
}

// Free children are zero-priced canonical admission lines; the intent amount
// is the positive sale total, so a zero line is valid but corrupt cents are not.
function normalizeLine(line: StripeTerminalLine) {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
    throw new Error("Stripe Terminal line quantity must be a positive integer");
  }
  if (!Number.isSafeInteger(line.unitAmountCents) || line.unitAmountCents < 0) {
    throw new Error("Stripe Terminal line unit amount must be a non-negative whole number of cents");
  }
  if (!Number.isSafeInteger(line.lineTotalCents) || line.quantity * line.unitAmountCents !== line.lineTotalCents) {
    throw new Error("Stripe Terminal line total is inconsistent");
  }

  return line;
}

export type TerminalIntentExpectation = {
  saleRef: string;
  amountCents: number;
  currency: "usd";
  stripeMode: StripeMode;
  attemptNonce: string;
  providerPaymentIntentId?: string;
};

const paymentIntentIdPattern = /^pi_[A-Za-z0-9]{8,200}$/;

export function isStripePaymentIntentId(value: unknown): value is string {
  return typeof value === "string" && paymentIntentIdPattern.test(value);
}

/** First field of a PaymentIntent that does not match the frozen attempt. */
export function terminalIntentMismatch(
  intent: StripeTerminalPaymentIntentResponse | null | undefined,
  expected: TerminalIntentExpectation
): string | null {
  if (!intent || typeof intent !== "object") return "intent_missing";
  if (intent.object !== "payment_intent") return "intent_object_invalid";
  if (!isStripePaymentIntentId(intent.id)) return "intent_id_invalid";
  if (expected.providerPaymentIntentId && intent.id !== expected.providerPaymentIntentId) return "intent_id_mismatch";
  if (typeof intent.livemode !== "boolean") return "intent_livemode_missing";
  if (intent.livemode !== (expected.stripeMode === "live")) return "intent_livemode_mismatch";
  const metadata = intent.metadata && typeof intent.metadata === "object" ? intent.metadata : {};
  if (metadata.sale_ref !== expected.saleRef) return "intent_sale_mismatch";
  if (metadata.source !== terminalIntentSource) return "intent_source_mismatch";
  if (metadata.attempt_nonce !== expected.attemptNonce) return "intent_attempt_nonce_mismatch";
  if (typeof intent.amount !== "number" || !Number.isSafeInteger(intent.amount)) return "intent_amount_missing";
  if (intent.amount !== expected.amountCents) return "intent_amount_mismatch";
  if (intent.currency !== expected.currency) return "intent_currency_mismatch";
  if (intent.capture_method !== "automatic") return "intent_capture_method_mismatch";
  if (!Array.isArray(intent.payment_method_types) || !intent.payment_method_types.includes("card_present")) {
    return "intent_payment_method_mismatch";
  }
  return null;
}

export type CreatedTerminalIntentVerification =
  | { ok: true; paymentIntentId: string }
  | { ok: false; reason: string };

/** A creation (or exact replay) response must describe the new, unpaid intent. */
export function verifyCreatedTerminalIntent(
  intent: StripeTerminalPaymentIntentResponse | null | undefined,
  expected: TerminalIntentExpectation
): CreatedTerminalIntentVerification {
  const mismatch = terminalIntentMismatch(intent, expected);
  if (mismatch) return { ok: false, reason: mismatch };
  if (intent!.status !== "requires_payment_method") return { ok: false, reason: "intent_not_new_at_creation" };
  return { ok: true, paymentIntentId: intent!.id as string };
}

export type RetrievedTerminalIntentState =
  | { state: "paid"; paymentIntentId: string }
  | { state: "canceled"; paymentIntentId: string }
  | { state: "open"; providerState: string }
  | { state: "mismatch"; reason: string }
  | { state: "unknown"; reason: string };

/**
 * Only a correlated `succeeded` intent whose full amount was received is
 * paid, and only a correlated `canceled` intent is closed. A decline leaves
 * the same intent payable (`requires_payment_method`); in-progress states are
 * never treated as paid or as a release.
 */
export function classifyRetrievedTerminalIntent(
  intent: StripeTerminalPaymentIntentResponse | null | undefined,
  expected: TerminalIntentExpectation
): RetrievedTerminalIntentState {
  const mismatch = terminalIntentMismatch(intent, expected);
  if (mismatch) return { state: "mismatch", reason: mismatch };
  const paymentIntentId = intent!.id as string;
  switch (intent!.status) {
    case "succeeded":
      return intent!.amount_received === expected.amountCents
        ? { state: "paid", paymentIntentId }
        : { state: "mismatch", reason: "intent_amount_received_mismatch" };
    case "canceled":
      return { state: "canceled", paymentIntentId };
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
    case "processing":
      return { state: "open", providerState: intent!.status };
    case "requires_capture":
      // Automatic capture should never leave an authorization; not paid.
      return { state: "unknown", reason: "intent_requires_capture" };
    default:
      return { state: "unknown", reason: "intent_status_unsupported" };
  }
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

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
