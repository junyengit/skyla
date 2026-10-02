import { stripeIdempotencyRetentionMs } from "./checkoutAttempts";

// A Terminal PaymentIntent has no Session expiry, so the only replay bound is
// Stripe's idempotency retention (at least 24 hours). Replays of the exact
// frozen create stop after 30 minutes or 5 requests, far inside it; after
// that an unknown creation is a visible exception and the hold stays.
export const terminalCreateReplayWindowMs = 30 * 60 * 1000;
export const terminalCreateMaxProviderRequests = 5;
export const terminalAttemptLeaseMs = 2 * 60 * 1000;
export const terminalReaderLeaseMs = 2 * 60 * 1000;
// First provider read soon after creation in case every webhook is missed.
export const terminalFirstReconcileDelayMs = 2 * 60 * 1000;
export const terminalReconcileMaxAttempts = 30;
export const terminalConfigMaxAttempts = 48;
// Reader handoffs of the one PaymentIntent; after this staff must review.
export const terminalReaderMaxProcessAttempts = 20;

if (terminalCreateReplayWindowMs >= stripeIdempotencyRetentionMs / 2) {
  throw new Error("Terminal replay window must end long before Stripe prunes the idempotency key");
}

export function terminalReplayWindowEndsAt(attempt: { createdAt: number }) {
  return attempt.createdAt + terminalCreateReplayWindowMs;
}

/**
 * A non-admin register user may only act on, read or refresh a POS sale they
 * started; an admin may act on any. A sale without a stored owner is shared.
 */
export function assertPosSaleOwner(
  staff: { _id: string; role: string },
  sale: { staffUserId?: string }
) {
  if (staff.role !== "admin" && sale.staffUserId && sale.staffUserId !== staff._id) {
    throw new Error("POS sale belongs to a different staff user");
  }
}

type StripeErrorShape = { type: string; code?: string };

function stripeErrorShape(body: unknown): StripeErrorShape | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const { type, code } = error as { type?: unknown; code?: unknown };
  if (typeof type !== "string" || !type) return undefined;
  // A blank code is malformed, not an omitted one, so it never proves rejection.
  if (code !== undefined && code !== null && (typeof code !== "string" || !code)) return undefined;
  return { type, ...(typeof code === "string" ? { code } : {}) };
}

// Stripe validates parameters and authentication before executing a request
// and stores no idempotent result for such failures, so these exact shapes
// prove the PaymentIntent was not created. Anything else, including other
// 4xx codes, 404/409/429, 5xx, an idempotency error or a malformed body, does
// not prove it and keeps the outcome unknown.
const terminalCreateValidationCodes = new Set([
  "parameter_invalid_empty",
  "parameter_invalid_integer",
  "parameter_invalid_string_empty",
  "parameter_missing",
  "parameter_unknown",
  "amount_too_small",
  "amount_too_large"
]);

export type TerminalCreateFailure = {
  kind: "unknown" | "rejected" | "conflict";
  reason: string;
};

export function classifyTerminalCreateFailure(status: number, body: unknown): TerminalCreateFailure {
  const error = stripeErrorShape(body);
  if (!error) return { kind: "unknown", reason: `stripe_http_${status}_malformed` };
  if (error.type === "idempotency_error") return { kind: "conflict", reason: "stripe_idempotency_conflict" };
  const reason = `stripe_${status}_${error.type}${error.code ? `_${error.code}` : ""}`.slice(0, 120);
  if (
    status === 400 &&
    error.type === "invalid_request_error" &&
    (error.code === undefined || terminalCreateValidationCodes.has(error.code))
  ) {
    return { kind: "rejected", reason };
  }
  if (error.code === undefined && isRecognizedAuthRefusal(status, error.type)) return { kind: "rejected", reason };
  return { kind: "unknown", reason };
}

// A reader command Stripe refused before it reached the reader. Every other
// failure (terminal_reader_timeout, offline or connection errors, unknown
// codes, 5xx, a malformed body) may follow a payment the reader collected.
const terminalReaderRejectionCodes = new Set([
  "terminal_reader_busy",
  "parameter_invalid_empty",
  "parameter_missing",
  "parameter_unknown"
]);

export type TerminalReaderFailure = { kind: "failed" | "unknown"; reason: string };

export function classifyTerminalReaderFailure(status: number, body: unknown): TerminalReaderFailure {
  const error = stripeErrorShape(body);
  if (!error) return { kind: "unknown", reason: `stripe_http_${status}_malformed` };
  const reason = `stripe_http_${status}_${error.code ?? error.type}`.slice(0, 120);
  if (status === 400 && error.type === "invalid_request_error" && error.code && terminalReaderRejectionCodes.has(error.code)) {
    return { kind: "failed", reason };
  }
  if (error.code === undefined && isRecognizedAuthRefusal(status, error.type)) return { kind: "failed", reason };
  return { kind: "unknown", reason };
}

// Only Stripe's own authentication and permission shapes prove a request was
// refused before execution; any other 401/403 body stays unknown.
function isRecognizedAuthRefusal(status: number, type: string) {
  return (
    (status === 401 && (type === "authentication_error" || type === "invalid_request_error")) ||
    (status === 403 && (type === "permission_error" || type === "invalid_request_error"))
  );
}

export const terminalPaymentStatePrefix = "Terminal payment state:";

export type TerminalPaymentStateCode =
  | "payment_in_progress"
  | "payment_already_received"
  | "payment_needs_attention"
  | "payment_closed"
  | "payment_outcome_unknown"
  | "reader_busy"
  | "reader_failed"
  | "refresh_required"
  | "sale_not_ready";

const terminalPaymentStateMessages: Record<TerminalPaymentStateCode, string> = {
  payment_in_progress: "This sale's payment is still starting. Use Refresh Status in a moment.",
  payment_already_received: "Payment for this sale was already received.",
  payment_needs_attention: "This sale's payment needs staff review. Do not charge the guest again.",
  payment_closed: "This sale is closed without payment. Start a new sale if needed.",
  payment_outcome_unknown: "The payment outcome is not confirmed yet. Do not charge again; use Refresh Status.",
  reader_busy: "The reader was just sent this payment. Use Refresh Status before sending it again.",
  reader_failed: "The reader did not start this payment. Check the reader, then send the same payment again.",
  refresh_required: "Stripe reports this payment is no longer waiting for a card. Use Refresh Status; do not charge again.",
  sale_not_ready: "This sale is not ready for the reader. Review it again."
};

/** A staff-safe conflict the POS routes return as HTTP 409 with its code. */
export function terminalPaymentStateError(code: TerminalPaymentStateCode) {
  return new Error(`${terminalPaymentStatePrefix} ${code}: ${terminalPaymentStateMessages[code]}`);
}

export function parseTerminalPaymentStateError(message: string) {
  const at = message.indexOf(terminalPaymentStatePrefix);
  if (at < 0) return null;
  const match = /^\s*([a-z_]+):\s*(.+)$/.exec(message.slice(at + terminalPaymentStatePrefix.length));
  if (!match || !(match[1] in terminalPaymentStateMessages)) return null;
  const code = match[1] as TerminalPaymentStateCode;
  return { code, message: terminalPaymentStateMessages[code] };
}
