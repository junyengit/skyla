export const checkoutDraftTtlMs = 30 * 60 * 1000;
export const checkoutDraftPaymentStartBufferMs = 60 * 1000;

export type CheckoutDraftExpiryRecord = {
  createdAt: number;
  expiresAt?: number;
  status: string;
};

export function checkoutDraftExpiresAt(order: Pick<CheckoutDraftExpiryRecord, "createdAt" | "expiresAt">) {
  return order.expiresAt ?? order.createdAt + checkoutDraftTtlMs;
}

export function checkoutDraftIsAbandoned(order: CheckoutDraftExpiryRecord, now: number) {
  return order.status === "draft" && checkoutDraftExpiresAt(order) <= now;
}

export function assertCheckoutDraftCanStartPayment(order: CheckoutDraftExpiryRecord, now: number) {
  if (order.status !== "draft" && order.status !== "payment_pending") {
    throw new Error(`Checkout order cannot create a Stripe session from status ${order.status}`);
  }
  if (
    order.status === "draft" &&
    checkoutDraftExpiresAt(order) <= now + checkoutDraftPaymentStartBufferMs
  ) {
    throw new Error("Checkout order draft has expired");
  }
}
