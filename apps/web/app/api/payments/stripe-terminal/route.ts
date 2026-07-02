import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

type StripeTerminalRequest = {
  saleRef?: unknown;
  idempotencyKey?: unknown;
};

type StripeTerminalActionArgs = {
  saleRef: string;
  idempotencyKey: string;
};

type StripeTerminalActionResult = {
  saleRef: string;
  provider: "terminal";
  paymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  currency: "usd";
  status: string;
};

const createStripeTerminalPaymentIntentAction = makeFunctionReference<
  "action",
  StripeTerminalActionArgs,
  StripeTerminalActionResult
>("payments:createStripeTerminalPaymentIntent");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = authorization.slice("bearer ".length).trim();
  return token || undefined;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function toPublicTerminalResult(result: StripeTerminalActionResult) {
  return {
    saleRef: result.saleRef,
    provider: result.provider,
    paymentIntentId: result.paymentIntentId,
    amountCents: result.amountCents,
    currency: result.currency,
    status: result.status
  };
}

function paymentFailureStatus(message: string) {
  const normalized = message.toLowerCase();
  if (message.includes("is required")) {
    return 400;
  }
  if (normalized.includes("auth") || normalized.includes("staff role")) {
    return 401;
  }
  if (
    normalized.includes("not configured") ||
    normalized.includes("stripe_secret_key") ||
    normalized.includes("terminal reader registry") ||
    normalized.includes("skyla_terminal_reader_registry")
  ) {
    return 503;
  }
  if (normalized.includes("different staff user")) {
    return 403;
  }
  if (normalized.includes("not found") || normalized.includes("cannot create")) {
    return 409;
  }
  return 502;
}

export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return Response.json(
        {
          error: "Convex is not configured for Stripe Terminal",
          code: "convex_unconfigured"
        },
        { status: 503 }
      );
    }

    const token = authToken(request);
    if (!token) {
      return Response.json(
        {
          error: "Staff authentication is required for Stripe Terminal",
          code: "staff_auth_required"
        },
        { status: 401 }
      );
    }

    const input = (await request.json()) as StripeTerminalRequest;
    const saleRef = requiredString(input.saleRef, "saleRef");
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");

    const result = await fetchAction(
      createStripeTerminalPaymentIntentAction,
      {
        saleRef,
        idempotencyKey
      },
      { url: deploymentUrl, token }
    );

    return Response.json(toPublicTerminalResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe Terminal payment";
    return Response.json({ error: message }, { status: paymentFailureStatus(message) });
  }
}
