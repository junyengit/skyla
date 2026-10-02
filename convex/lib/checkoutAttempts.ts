import type { StripeCheckoutSessionResponse } from "./stripeCheckout";
import type { StripeMode } from "./stripeMode";

// Stripe accepts expires_at from 30 minutes to 24 hours after creation. The
// Session lives 45 minutes so a guest has time to pay, and a replay of the
// frozen request inside the replay window still clears the 30-minute minimum
// with a network margin. Stripe keeps idempotency results for at least 24
// hours; replays stop long before that, so a pruned key is never replayed into
// a second Session.
export const checkoutSessionLifetimeMs = 45 * 60 * 1000;
export const stripeMinimumSessionLifetimeMs = 30 * 60 * 1000;
export const checkoutCreateReplayWindowMs = 10 * 60 * 1000;
export const stripeIdempotencyRetentionMs = 24 * 60 * 60 * 1000;
export const checkoutCreateMaxProviderRequests = 4;
export const checkoutAttemptLeaseMs = 2 * 60 * 1000;
export const checkoutProviderTimeoutMs = 20_000;
// A stored Session URL is only handed back while it can still be paid.
export const checkoutResumeMinRemainingMs = 2 * 60 * 1000;
export const checkoutExpiryReconcileMarginMs = 2 * 60 * 1000;
export const checkoutReconcileMaxAttempts = 30;
export const checkoutConfigMaxAttempts = 48;

if (checkoutSessionLifetimeMs - checkoutCreateReplayWindowMs < stripeMinimumSessionLifetimeMs + 5 * 60 * 1000) {
  throw new Error("Checkout replay window leaves too little Session lifetime for Stripe's minimum");
}

const reconcileBackoffSchedule = [30, 60, 120, 300, 600, 900, 1800, 3600].map((seconds) => seconds * 1000);
const configBackoffSchedule = [15, 30, 60].map((minutes) => minutes * 60 * 1000);

export function reconcileBackoffMs(attempt: number) {
  return reconcileBackoffSchedule[Math.min(Math.max(0, attempt), reconcileBackoffSchedule.length - 1)];
}

export function configBackoffMs(attempt: number) {
  return configBackoffSchedule[Math.min(Math.max(0, attempt), configBackoffSchedule.length - 1)];
}

/**
 * Last moment the exact frozen request may be replayed with its key: inside
 * the replay window, and while the frozen expires_at still clears Stripe's
 * 30-minute minimum with a margin. Never near the 24-hour key retention.
 */
export function checkoutReplayWindowEndsAt(attempt: { createdAt: number; expiresAt: number }) {
  return Math.min(
    attempt.createdAt + checkoutCreateReplayWindowMs,
    attempt.expiresAt - stripeMinimumSessionLifetimeMs - 5 * 60 * 1000,
    attempt.createdAt + stripeIdempotencyRetentionMs / 2
  );
}

export const checkoutPaymentStatePrefix = "Checkout payment state:";

export type CheckoutPaymentStateCode =
  | "payment_in_progress"
  | "payment_already_received"
  | "payment_session_closed"
  | "payment_session_expiring"
  | "payment_needs_attention";

const checkoutPaymentStateMessages: Record<CheckoutPaymentStateCode, string> = {
  payment_in_progress: "Your card payment page is still being prepared. Check again in a moment.",
  payment_already_received: "Payment for this order was already received.",
  payment_session_closed: "This payment session has ended without payment. Start a new order to try again.",
  payment_session_expiring: "This payment session is about to expire. Check its status before starting a new order.",
  payment_needs_attention:
    "This payment needs help from our team. Please don't pay again; email reservations@skydeckla.com."
};

/** A customer-safe conflict that the gateway returns as HTTP 409 with its code. */
export function checkoutPaymentStateError(code: CheckoutPaymentStateCode) {
  return new Error(`${checkoutPaymentStatePrefix} ${code}: ${checkoutPaymentStateMessages[code]}`);
}

export function parseCheckoutPaymentStateError(message: string) {
  const at = message.indexOf(checkoutPaymentStatePrefix);
  if (at < 0) return null;
  const match = /^\s*([a-z_]+):\s*(.+)$/.exec(message.slice(at + checkoutPaymentStatePrefix.length));
  if (!match || !(match[1] in checkoutPaymentStateMessages)) return null;
  const code = match[1] as CheckoutPaymentStateCode;
  return { code, message: checkoutPaymentStateMessages[code] };
}

export type CheckoutSessionExpectation = {
  orderRef: string;
  amountCents: number;
  currency: "usd";
  stripeMode: StripeMode;
  /** Absent only for an adopted legacy Session created before attempt nonces. */
  attemptNonce?: string;
  providerSessionId?: string;
  /** Frozen expiry in ms, checked on the creation response. */
  expiresAt?: number;
};

const sessionIdPattern = /^cs_(test|live)_[A-Za-z0-9]{8,200}$/;

/** First field that does not match the stored attempt, or null. */
export function checkoutSessionMismatch(
  session: StripeCheckoutSessionResponse | null | undefined,
  expected: CheckoutSessionExpectation
): string | null {
  if (!session || typeof session !== "object") return "session_missing";
  if (session.object !== "checkout.session") return "session_object_invalid";
  const id = session.id;
  if (typeof id !== "string" || !sessionIdPattern.test(id)) return "session_id_invalid";
  if (expected.providerSessionId && id !== expected.providerSessionId) return "session_id_mismatch";
  if (typeof session.livemode !== "boolean") return "session_livemode_missing";
  if (session.livemode !== (expected.stripeMode === "live")) return "session_livemode_mismatch";
  if (!id.startsWith(expected.stripeMode === "live" ? "cs_live_" : "cs_test_")) return "session_livemode_mismatch";
  if (session.mode === undefined || session.mode === null) return "session_mode_missing";
  if (session.mode !== "payment") return "session_mode_invalid";
  if (session.client_reference_id !== expected.orderRef) return "session_order_mismatch";
  const metadata = session.metadata && typeof session.metadata === "object" ? session.metadata : {};
  if (metadata.order_ref !== expected.orderRef) return "session_order_mismatch";
  if (expected.attemptNonce !== undefined && metadata.attempt_nonce !== expected.attemptNonce) {
    return "session_attempt_nonce_mismatch";
  }
  if (typeof session.amount_total !== "number" || !Number.isSafeInteger(session.amount_total)) {
    return "session_amount_missing";
  }
  if (session.amount_total !== expected.amountCents) return "session_amount_mismatch";
  if (typeof session.currency !== "string") return "session_currency_missing";
  if (session.currency !== expected.currency) return "session_currency_mismatch";
  if (expected.expiresAt !== undefined && session.expires_at !== Math.floor(expected.expiresAt / 1000)) {
    return "session_expiry_mismatch";
  }
  return null;
}

export type CreatedCheckoutSessionVerification =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; reason: string };

export function verifyCreatedCheckoutSession(
  session: StripeCheckoutSessionResponse | null | undefined,
  expected: CheckoutSessionExpectation
): CreatedCheckoutSessionVerification {
  const mismatch = checkoutSessionMismatch(session, expected);
  if (mismatch) return { ok: false, reason: mismatch };
  // A replay returns Stripe's stored creation response, so the Session is
  // open and unpaid in the body even if it has since changed.
  if (session!.status !== "open" || session!.payment_status !== "unpaid") {
    return { ok: false, reason: "session_not_open_at_creation" };
  }
  const url = session!.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return { ok: false, reason: "session_url_missing" };
  }
  return { ok: true, sessionId: session!.id as string, url };
}

export type RetrievedCheckoutSessionState =
  | { state: "paid"; providerPaymentIntentId: string }
  | { state: "open" }
  | { state: "complete_unpaid" }
  | { state: "expired" }
  | { state: "mismatch"; reason: string }
  | { state: "unknown"; reason: string };

export function checkoutSessionPaymentIntentId(session: StripeCheckoutSessionResponse) {
  const value = session.payment_intent;
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id) return value.id;
  return undefined;
}

/**
 * Distinguishes paid, open, complete-but-unpaid, expired and unknown provider
 * states. Only a correlated expired+unpaid Session may release an unpaid hold.
 */
export function classifyRetrievedCheckoutSession(
  session: StripeCheckoutSessionResponse | null | undefined,
  expected: CheckoutSessionExpectation
): RetrievedCheckoutSessionState {
  const mismatch = checkoutSessionMismatch(session, expected);
  if (mismatch) return { state: "mismatch", reason: mismatch };
  const status = session!.status;
  const paymentStatus = session!.payment_status;
  if (status === "complete" && paymentStatus === "paid") {
    const providerPaymentIntentId = checkoutSessionPaymentIntentId(session!);
    return providerPaymentIntentId
      ? { state: "paid", providerPaymentIntentId }
      : { state: "mismatch", reason: "paid_session_without_payment_intent" };
  }
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") {
    return { state: "mismatch", reason: `session_${status ?? "unknown"}_${paymentStatus}` };
  }
  if (paymentStatus !== "unpaid") return { state: "unknown", reason: "session_payment_status_unsupported" };
  if (status === "open") return { state: "open" };
  if (status === "complete") return { state: "complete_unpaid" };
  if (status === "expired") return { state: "expired" };
  return { state: "unknown", reason: "session_status_unsupported" };
}

export type StripeCreateFailure =
  | { kind: "rejected"; reason: string }
  | { kind: "conflict"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * A timeout, 409, 429, 5xx or unreadable body leaves the outcome unknown:
 * Stripe may have created a payable Session. Only a structured 4xx validation
 * or authorization error proves that this request created nothing.
 */
export function classifyStripeCreateFailure(status: number, body: unknown): StripeCreateFailure {
  const error =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as { type?: unknown })
      : undefined;
  const type = typeof error?.type === "string" ? error.type : undefined;
  if (type === "idempotency_error") return { kind: "conflict", reason: "stripe_idempotency_conflict" };
  if (status >= 400 && status <= 404 && type && type !== "api_error") {
    return { kind: "rejected", reason: `stripe_${status}_${type}` };
  }
  return { kind: "unknown", reason: `stripe_http_${status}` };
}
