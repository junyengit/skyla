import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { invalidPaymentRequest, paymentJson, paymentProviderUnavailable, paymentServiceUnavailable } from "../_shared";

type StripeCheckoutRequest = {
  orderRef?: unknown;
  idempotencyKey?: unknown;
};

type StripeCheckoutActionArgs = {
  orderRef: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
};

type StripeCheckoutActionResult = {
  orderRef: string;
  provider: "stripe";
  checkoutSessionId: string;
  url: string;
  amountCents: number;
  currency: "usd";
};

const createStripeCheckoutSessionAction = makeFunctionReference<
  "action",
  StripeCheckoutActionArgs,
  StripeCheckoutActionResult
>("payments:createStripeCheckoutSession");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function originFor(request: Request) {
  const headerOrigin = request.headers.get("origin");
  if (headerOrigin) {
    return new URL(headerOrigin).origin;
  }
  return new URL(request.url).origin;
}

function isServerConfigurationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not configured") ||
    normalized.includes("stripe_secret_key") ||
    normalized.includes("skyla_stripe_mode") ||
    normalized.includes("skyla_payment_return_origins") ||
    normalized.includes("does not match")
  );
}

function toPublicCheckoutResult(result: StripeCheckoutActionResult) {
  return {
    orderRef: result.orderRef,
    provider: result.provider,
    checkoutSessionId: result.checkoutSessionId,
    url: result.url,
    amountCents: result.amountCents,
    currency: result.currency
  };
}

export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(
        {
          error: "Convex is not configured for Stripe Checkout",
          code: "convex_unconfigured"
        },
        { status: 503 }
      );
    }

    const input = (await request.json()) as StripeCheckoutRequest;
    const orderRef = requiredString(input.orderRef, "orderRef");
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
    const origin = originFor(request);

    const result = await fetchAction(
      createStripeCheckoutSessionAction,
      {
        orderRef,
        idempotencyKey,
        successUrl: `${origin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/checkout?stripe=cancel`
      },
      { url: deploymentUrl }
    );

    return paymentJson(toPublicCheckoutResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe Checkout";
    const status = message.includes("is required") || message.includes("origin is not allowed")
      ? 400
      : isServerConfigurationError(message)
        ? 503
        : 502;
    const body = status === 400
      ? invalidPaymentRequest(message.includes("origin is not allowed") ? "Stripe Checkout return origin is not allowed" : message)
      : status === 503
        ? paymentServiceUnavailable("Stripe Checkout")
        : paymentProviderUnavailable("Stripe Checkout");

    return paymentJson(body, { status });
  }
}
