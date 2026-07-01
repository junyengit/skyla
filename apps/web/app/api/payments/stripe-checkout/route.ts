import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

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

export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return Response.json(
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
        successUrl: `${origin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}&order=${encodeURIComponent(orderRef)}`,
        cancelUrl: `${origin}/checkout?stripe=cancel&order=${encodeURIComponent(orderRef)}`
      },
      { url: deploymentUrl }
    );

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe Checkout";
    const status = message.includes("is required") || message.includes("origin is not allowed")
      ? 400
      : message.toLowerCase().includes("not configured")
        ? 503
        : 502;

    return Response.json({ error: message }, { status });
  }
}
