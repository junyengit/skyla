import { callPublicConvexGateway, PublicGatewayError } from "../../../../lib/public-convex-gateway";
import {
  assertCurrentCheckoutLegalAcceptance,
  type CheckoutLegalAcceptanceInput
} from "@skyla/payments";
import { ticketSalesUnavailableResponse } from "../../ticket-sales-gate";
import { invalidPaymentRequest, paymentJson, paymentProviderUnavailable, paymentServiceUnavailable } from "../_shared";

type StripeCheckoutRequest = {
  orderRef?: unknown;
  idempotencyKey?: unknown;
  legalAcceptance?: unknown;
};

type StripeCheckoutGatewayInput = {
  orderRef: string;
  idempotencyKey: string;
  legalAcceptance: CheckoutLegalAcceptanceInput;
  successUrl: string;
  cancelUrl: string;
};

type StripeCheckoutGatewayResult = {
  orderRef: string;
  provider: "stripe";
  checkoutSessionId: string;
  url: string;
  amountCents: number;
  currency: "usd";
};

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requiredLegalAcceptance(value: unknown): CheckoutLegalAcceptanceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Terms and liability waiver acceptance are required before payment");
  }
  const candidate = value as Record<string, unknown>;
  const input: CheckoutLegalAcceptanceInput = {
    termsAccepted: candidate.termsAccepted === true,
    termsVersion: requiredString(candidate.termsVersion, "termsVersion"),
    liabilityWaiverAccepted: candidate.liabilityWaiverAccepted === true,
    liabilityWaiverVersion: requiredString(candidate.liabilityWaiverVersion, "liabilityWaiverVersion")
  };
  assertCurrentCheckoutLegalAcceptance(input);
  return input;
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

function toPublicCheckoutResult(result: StripeCheckoutGatewayResult) {
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
  const unavailable = ticketSalesUnavailableResponse();
  if (unavailable) {
    return unavailable;
  }

  try {
    const input = (await request.json()) as StripeCheckoutRequest;
    const orderRef = requiredString(input.orderRef, "orderRef");
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");
    const legalAcceptance = requiredLegalAcceptance(input.legalAcceptance);
    const origin = originFor(request);

    const result = await callPublicConvexGateway<StripeCheckoutGatewayResult>(
      request,
      "stripe-checkout",
      {
        orderRef,
        idempotencyKey,
        legalAcceptance,
        successUrl: `${origin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/checkout?stripe=cancel`
      } satisfies StripeCheckoutGatewayInput
    );

    return paymentJson(toPublicCheckoutResult(result));
  } catch (error) {
    if (error instanceof PublicGatewayError) {
      const headers = error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined;
      if (error.status === 429) {
        return paymentJson(
          {
            error: "Too many Stripe Checkout attempts. Please try again later.",
            code: "rate_limited",
            ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
          },
          { status: 429, headers }
        );
      }
      if (error.status === 400 || error.status === 409) {
        return paymentJson(invalidPaymentRequest(error.message), { status: error.status, headers });
      }
      return paymentJson(
        error.status === 503
          ? paymentServiceUnavailable("Stripe Checkout")
          : paymentProviderUnavailable("Stripe Checkout"),
        { status: error.status, headers }
      );
    }
    const message = error instanceof Error ? error.message : "Could not start Stripe Checkout";
    const status =
      message.includes("is required") ||
      message.includes("acceptance") ||
      message.includes("out of date") ||
      message.includes("origin is not allowed")
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
