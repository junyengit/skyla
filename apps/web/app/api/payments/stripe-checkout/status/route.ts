import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { invalidPaymentRequest, paymentJson, paymentServiceUnavailable } from "../../_shared";

type CheckoutStatusArgs = {
  checkoutSessionId: string;
};

type CheckoutStatusResult = {
  orderRef: string;
  status: "pending" | "confirmed" | "failed" | "canceled";
};

const getCheckoutReturnStatusQuery = makeFunctionReference<"query", CheckoutStatusArgs, CheckoutStatusResult>(
  "checkoutStatus:getCheckoutReturnStatus"
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

export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(
        { error: "Checkout confirmation is not available right now", code: "convex_unconfigured" },
        { status: 503 }
      );
    }

    const input = (await request.json()) as { checkoutSessionId?: unknown };
    const result = await fetchQuery(
      getCheckoutReturnStatusQuery,
      {
        checkoutSessionId: requiredString(input.checkoutSessionId, "checkoutSessionId")
      },
      { url: deploymentUrl }
    );

    return paymentJson({ orderRef: result.orderRef, status: result.status });
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
