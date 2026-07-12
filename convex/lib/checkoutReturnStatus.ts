export type CheckoutReturnStatus = "pending" | "confirmed" | "failed" | "canceled";

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
}): CheckoutReturnStatus {
  if (input.orderStatus === "paid" && input.paymentStatuses.includes("paid") && input.bookingExists) {
    return "confirmed";
  }
  if (input.paymentStatuses.includes("failed")) {
    return "failed";
  }
  if (input.orderStatus === "canceled" || input.orderStatus === "expired" || input.paymentStatuses.includes("canceled")) {
    return "canceled";
  }
  return "pending";
}
