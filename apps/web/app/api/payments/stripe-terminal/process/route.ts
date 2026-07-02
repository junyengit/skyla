import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

type StripeTerminalProcessRequest = {
  saleRef?: unknown;
  idempotencyKey?: unknown;
};

type StripeTerminalProcessActionArgs = {
  saleRef: string;
  idempotencyKey: string;
};

type StripeTerminalProcessActionResult = {
  saleRef: string;
  provider: "terminal";
  paymentIntentId: string;
  readerId: string;
  amountCents: number;
  currency: "usd";
  status: "processing" | "failed";
  readerStatus: string;
  readerActionStatus: string;
};

const processStripeTerminalPaymentIntentAction = makeFunctionReference<
  "action",
  StripeTerminalProcessActionArgs,
  StripeTerminalProcessActionResult
>("payments:processStripeTerminalPaymentIntent");

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
  if (normalized.includes("not found") || normalized.includes("cannot") || normalized.includes("not have")) {
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
          error: "Convex is not configured for Stripe Terminal reader processing",
          code: "convex_unconfigured"
        },
        { status: 503 }
      );
    }

    const token = authToken(request);
    if (!token) {
      return Response.json(
        {
          error: "Staff authentication is required for Stripe Terminal reader processing",
          code: "staff_auth_required"
        },
        { status: 401 }
      );
    }

    const input = (await request.json()) as StripeTerminalProcessRequest;
    const saleRef = requiredString(input.saleRef, "saleRef");
    const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey");

    const result = await fetchAction(
      processStripeTerminalPaymentIntentAction,
      {
        saleRef,
        idempotencyKey
      },
      { url: deploymentUrl, token }
    );

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process Stripe Terminal payment";
    return Response.json({ error: message }, { status: paymentFailureStatus(message) });
  }
}
