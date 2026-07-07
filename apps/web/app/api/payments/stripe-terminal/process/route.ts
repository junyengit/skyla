import { fetchAction } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  invalidPaymentRequest,
  paymentForbidden,
  paymentJson,
  paymentProviderUnavailable,
  paymentServiceUnavailable,
  paymentStateConflict
} from "../../_shared";

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

function terminalAcceptanceEnabled() {
  return process.env.SKYLA_POS_TERMINAL_ACCEPTANCE === "enabled";
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

function toPublicTerminalProcessResult(result: StripeTerminalProcessActionResult) {
  return {
    saleRef: result.saleRef,
    provider: result.provider,
    paymentIntentId: result.paymentIntentId,
    readerId: result.readerId,
    amountCents: result.amountCents,
    currency: result.currency,
    status: result.status,
    readerStatus: result.readerStatus,
    readerActionStatus: result.readerActionStatus
  };
}

function paymentFailureStatus(message: string) {
  const normalized = message.toLowerCase();
  if (message.includes("is required")) {
    return 400;
  }
  if (normalized.includes("staff role") || normalized.includes("different staff user")) {
    return 403;
  }
  if (normalized.includes("auth")) {
    return 401;
  }
  if (
    normalized.includes("not configured") ||
    normalized.includes("stripe_secret_key") ||
    normalized.includes("skyla_stripe_mode") ||
    normalized.includes("does not match") ||
    normalized.includes("terminal reader registry") ||
    normalized.includes("skyla_terminal_reader_registry") ||
    normalized.includes("skyla_pos_terminal_acceptance") ||
    normalized.includes("not enabled")
  ) {
    return 503;
  }
  if (normalized.includes("not found") || normalized.includes("cannot") || normalized.includes("not have")) {
    return 409;
  }
  return 502;
}

function publicPaymentFailureBody(status: number, message: string) {
  if (status === 400) {
    return invalidPaymentRequest(message);
  }
  if (status === 401) {
    return {
      error: "Staff authentication is required for Stripe Terminal reader processing",
      code: "staff_auth_required"
    };
  }
  if (status === 403) {
    return paymentForbidden("Stripe Terminal reader processing");
  }
  if (status === 409) {
    return paymentStateConflict("Stripe Terminal reader processing");
  }
  if (status === 503) {
    return paymentServiceUnavailable("Stripe Terminal reader processing");
  }
  return paymentProviderUnavailable("Stripe Terminal reader processing");
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return paymentJson(
        {
          error: "Staff authentication is required for Stripe Terminal reader processing",
          code: "staff_auth_required"
        },
        { status: 401 },
        { varyAuthorization: true }
      );
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(
        {
          error: "Convex is not configured for Stripe Terminal reader processing",
          code: "convex_unconfigured"
        },
        { status: 503 },
        { varyAuthorization: true }
      );
    }

    if (!terminalAcceptanceEnabled()) {
      return paymentJson(
        {
          error: "POS Terminal acceptance is not enabled",
          code: "pos_terminal_acceptance_required"
        },
        { status: 503 },
        { varyAuthorization: true }
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

    return paymentJson(toPublicTerminalProcessResult(result), {}, { varyAuthorization: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process Stripe Terminal payment";
    const status = paymentFailureStatus(message);
    return paymentJson(publicPaymentFailureBody(status, message), { status }, { varyAuthorization: true });
  }
}
