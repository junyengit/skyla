export type CheckoutReturnStatus = "pending" | "confirmed" | "failed" | "canceled" | "needs_attention";

/** Same-browser purchase-intent states; never derived from browser input. */
export type CheckoutAttemptStatus =
  | CheckoutReturnStatus
  | "not_started"
  | "awaiting_payment";

const checkoutSessionIdPattern = /^cs_(test|live)_[A-Za-z0-9]{16,200}$/;

export function normalizeCheckoutReturnIdentity(checkoutSessionId: string) {
  const normalizedSessionId = checkoutSessionId.trim();

  if (!checkoutSessionIdPattern.test(normalizedSessionId)) {
    throw new Error("checkoutSessionId is invalid");
  }

  return { checkoutSessionId: normalizedSessionId };
}

export function projectCheckoutReturnStatus(input: {
  orderStatus: "draft" | "payment_pending" | "paid" | "canceled" | "expired";
  paymentStatuses: Array<"created" | "requires_payment" | "processing" | "paid" | "failed" | "canceled" | "refunded">;
  bookingExists: boolean;
  /** An open billing or attempt exception: money may be held without a ticket. */
  needsAttention?: boolean;
}): CheckoutReturnStatus {
  if (input.orderStatus === "paid" && input.paymentStatuses.includes("paid") && input.bookingExists) {
    return "confirmed";
  }
  if (input.needsAttention) {
    return "needs_attention";
  }
  if (input.paymentStatuses.includes("failed")) {
    return "failed";
  }
  if (input.orderStatus === "canceled" || input.orderStatus === "expired" || input.paymentStatuses.includes("canceled")) {
    return "canceled";
  }
  return "pending";
}

/**
 * Status of one order's payment attempt for the browser that started it.
 * Unknown or in-flight creation stays pending so the guest is never invited
 * to pay a second time.
 */
export function projectCheckoutAttemptStatus(input: {
  orderStatus: "draft" | "payment_pending" | "paid" | "canceled" | "expired";
  attempt?: { status: string; expiresAt: number };
  paymentStatuses: Parameters<typeof projectCheckoutReturnStatus>[0]["paymentStatuses"];
  bookingExists: boolean;
  needsAttention: boolean;
  now: number;
}): CheckoutAttemptStatus {
  if (!input.attempt && input.orderStatus === "draft") return "not_started";
  const projected = projectCheckoutReturnStatus({
    ...input,
    needsAttention: input.needsAttention || input.attempt?.status === "exception"
  });
  if (projected !== "pending") return projected;
  if (input.attempt?.status === "open" && input.attempt.expiresAt > input.now) return "awaiting_payment";
  return "pending";
}
