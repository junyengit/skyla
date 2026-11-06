import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { invalidPaymentRequest, paymentJson, paymentServiceUnavailable } from "../../_shared";

type CheckoutStatusArgs = {
  checkoutSessionId: string;
};

type CheckoutAttemptStatusArgs = {
  orderRef: string;
  idempotencyKey: string;
};

type CheckoutStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "canceled"
  | "needs_attention"
  | "not_started"
  | "awaiting_payment";

type CheckoutStatusResult = {
  orderRef: string;
  status: CheckoutStatus;
  bookingRef?: string;
  ticketCode?: string;
  expiresAt?: number;
};

const getCheckoutReturnStatusQuery = makeFunctionReference<"query", CheckoutStatusArgs, CheckoutStatusResult>(
  "checkoutStatus:getCheckoutReturnStatus"
);
const getCheckoutAttemptStatusQuery = makeFunctionReference<"query", CheckoutAttemptStatusArgs, CheckoutStatusResult>(
  "checkoutStatus:getCheckoutAttemptStatus"
);

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function requiredString(value: unknown, key: string) {
  if (typeof value !== "string") {
    throw new Error(`${key} is required`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${key} is required`);
  }
  if (normalized.length > 220) {
    throw new Error(`${key} is invalid`);
  }
  return normalized;
}

/**
 * Reads stored payment state for a Stripe return (Session id) or for the
 * browser that started the payment (order ref plus its private idempotency
 * key). It never trusts a browser-supplied amount or status.
 */
export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(
        { error: "Checkout confirmation is not available right now", code: "convex_unconfigured" },
        { status: 503 }
      );
    }

    const input = (await request.json()) as { checkoutSessionId?: unknown; orderRef?: unknown; idempotencyKey?: unknown };
    const result = input.checkoutSessionId === undefined && input.orderRef !== undefined
      ? await fetchQuery(
          getCheckoutAttemptStatusQuery,
          {
            orderRef: requiredString(input.orderRef, "orderRef"),
            idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey")
          },
          { url: deploymentUrl }
        )
      : await fetchQuery(
          getCheckoutReturnStatusQuery,
          {
            checkoutSessionId: requiredString(input.checkoutSessionId, "checkoutSessionId")
          },
          { url: deploymentUrl }
        );

    return paymentJson({
      orderRef: result.orderRef,
      status: result.status,
      bookingRef: result.bookingRef,
      ticketCode: result.ticketCode,
      expiresAt: result.status === "awaiting_payment" ? result.expiresAt : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check Checkout confirmation";
    if (error instanceof SyntaxError || message.includes("is required") || message.includes("is invalid")) {
      return paymentJson(invalidPaymentRequest("A valid Checkout return identity is required"), { status: 400 });
    }
    if (message.includes("not found")) {
      return paymentJson({ error: "Checkout confirmation was not found", code: "checkout_not_found" }, { status: 404 });
    }
    return paymentJson(paymentServiceUnavailable("Checkout confirmation"), { status: 502 });
  }
}
