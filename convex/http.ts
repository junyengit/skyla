import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  publicGatewayRateLimitError,
  publicGatewaySecretMatches,
  validPublicGatewaySecret,
  type PublicGatewayOperation
} from "./lib/publicGateway";
import {
  assertStripeWebhookMode,
  parseStripeMode
} from "./lib/stripeMode";
import {
  stripeCheckoutOutcomeFromEvent,
  stripeRefundOutcomeFromEvent,
  stripeRefundWebhookDisposition,
  stripeTerminalPaymentIntentOutcomeFromEvent,
  stripeWebhookObjectType,
  verifyStripeWebhookSignature,
  type StripeWebhookEvent
} from "./lib/stripeWebhook";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();

export const publicGateway = httpAction(async (ctx, request) => {
    const gatewaySecret = process.env.SKYLA_PUBLIC_GATEWAY_SECRET?.trim();
    if (!validPublicGatewaySecret(gatewaySecret)) {
      return gatewayJson(
        { ok: false, code: "public_gateway_unconfigured", error: "Public gateway is not configured" },
        { status: 503 }
      );
    }

    const candidate = bearerToken(request.headers.get("authorization"));
    if (!(await publicGatewaySecretMatches(gatewaySecret!, candidate))) {
      return gatewayJson(
        { ok: false, code: "public_gateway_unauthorized", error: "Public gateway authorization failed" },
        { status: 401 }
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 32_768) {
      return gatewayJson(
        { ok: false, code: "request_too_large", error: "Request body is too large" },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (rawBody.length > 32_768) {
      return gatewayJson(
        { ok: false, code: "request_too_large", error: "Request body is too large" },
        { status: 413 }
      );
    }

    let payload: PublicGatewayPayload;
    try {
      payload = parsePublicGatewayPayload(JSON.parse(rawBody));
    } catch {
      return gatewayJson(
        { ok: false, code: "invalid_request", error: "Public gateway request is invalid" },
        { status: 400 }
      );
    }

    try {
      const args = {
        ...payload.input,
        gatewayRateLimitKey: payload.rateLimitKey
      } as never;
      const result = payload.operation === "experience-inquiry"
        ? await ctx.runMutation(internal.inquiries.submitInquiry, args)
        : payload.operation === "member-application"
          ? await ctx.runMutation(internal.memberApplications.submitApplication, args)
          : payload.operation === "checkout-draft"
            ? await ctx.runMutation(internal.orderDrafts.createCheckoutOrderDraft, args)
            : await ctx.runAction(internal.payments.createStripeCheckoutSession, args);

      return gatewayJson({ ok: true, result });
    } catch (error) {
      const rateLimit = publicGatewayRateLimitError(error);
      if (rateLimit) {
        return gatewayJson(
          {
            ok: false,
            code: "rate_limited",
            error: "Too many requests. Please try again later.",
            retryAfterSeconds: rateLimit.retryAfterSeconds
          },
          {
            status: 429,
            headers: { "retry-after": String(rateLimit.retryAfterSeconds) }
          }
        );
      }

      const failure = publicGatewayFailure(error);
      return gatewayJson(
        { ok: false, code: failure.code, error: failure.error },
        { status: failure.status }
      );
    }
});

http.route({
  path: "/public-gateway",
  method: "POST",
  handler: publicGateway
});

http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const verification = await verifyStripeWebhookSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET
    );
    if (!verification.ok) {
      return json(
        { ok: false, error: verification.reason },
        { status: verification.reason === "missing_secret" ? 500 : 401 }
      );
    }

    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(rawBody) as StripeWebhookEvent;
    } catch {
      return json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    try {
      assertStripeWebhookMode(event, parseStripeMode(process.env.SKYLA_STRIPE_MODE));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe mode check failed";
      return json(
        { ok: false, error: message },
        { status: message.includes("not configured") ? 500 : 400 }
      );
    }

    if (stripeWebhookObjectType(event) === "payment_intent") {
      const outcome = stripeTerminalPaymentIntentOutcomeFromEvent(event);
      const result = await ctx.runMutation(
        internal.paymentInternals.recordStripeTerminalWebhook,
        withoutUndefined({
          providerEventId: outcome.providerEventId,
          eventType: outcome.eventType,
          outcome: outcome.outcome,
          providerPaymentId: "providerPaymentId" in outcome ? outcome.providerPaymentId : undefined,
          saleRef: outcome.saleRef,
          ticketCode: outcome.outcome === "paid" ? newTicketCode() : undefined,
          amountCents: "amountCents" in outcome ? outcome.amountCents : undefined,
          currency: "currency" in outcome ? outcome.currency : undefined,
          raw: outcome.raw
        })
      );

      return json({
        ok: result.status !== "failed",
        status: result.status,
        duplicate: result.duplicate,
        saleRef: result.saleRef
      });
    }

    if (stripeWebhookObjectType(event) === "refund") {
      const outcome = stripeRefundOutcomeFromEvent(event);
      const result = await ctx.runMutation(
        internal.paymentInternals.recordStripeRefundWebhook,
        withoutUndefined({
          providerEventId: outcome.providerEventId,
          eventType: outcome.eventType,
          outcome: outcome.outcome,
          providerRefundId: "providerRefundId" in outcome ? outcome.providerRefundId : undefined,
          providerPaymentIntentId:
            "providerPaymentIntentId" in outcome ? outcome.providerPaymentIntentId : undefined,
          refundStatus: "status" in outcome ? outcome.status : undefined,
          amountCents: "amountCents" in outcome ? outcome.amountCents : undefined,
          currency: "currency" in outcome ? outcome.currency : undefined,
          reason: "reason" in outcome ? outcome.reason : undefined,
          failureReason: "failureReason" in outcome ? outcome.failureReason : undefined,
          providerEventCreatedAt:
            "providerEventCreatedAt" in outcome ? outcome.providerEventCreatedAt : undefined,
          raw: outcome.raw
        })
      );
      const disposition = stripeRefundWebhookDisposition(result.status);
      return json(
        {
          ok: disposition.ok,
          status: result.status,
          duplicate: result.duplicate,
          orderRef: result.orderRef,
          saleRef: result.saleRef
        },
        { status: disposition.httpStatus }
      );
    }

    const outcome = stripeCheckoutOutcomeFromEvent(event);
    const result = await ctx.runMutation(
      internal.paymentInternals.recordStripeCheckoutWebhook,
      withoutUndefined({
        providerEventId: outcome.providerEventId,
        eventType: outcome.eventType,
        outcome: outcome.outcome,
        providerPaymentId: "providerPaymentId" in outcome ? outcome.providerPaymentId : undefined,
        providerPaymentIntentId:
          "providerPaymentIntentId" in outcome ? outcome.providerPaymentIntentId : undefined,
        orderRef: outcome.orderRef,
        ticketCode: outcome.outcome === "paid" ? newTicketCode() : undefined,
        amountCents: "amountCents" in outcome ? outcome.amountCents : undefined,
        currency: "currency" in outcome ? outcome.currency : undefined,
        raw: outcome.raw
      })
    );

    return json({
      ok: result.status !== "failed",
      status: result.status,
      duplicate: result.duplicate,
      orderRef: result.orderRef
    });
  })
});

http.route({
  path: "/stripe-webhook",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, route: "stripe-webhook" }))
});

export default http;

function newTicketCode() {
  return `tkt_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

function gatewayJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

type PublicGatewayPayload = {
  operation: PublicGatewayOperation;
  rateLimitKey: string;
  input: Record<string, unknown>;
};

function parsePublicGatewayPayload(value: unknown): PublicGatewayPayload {
  if (!value || typeof value !== "object") {
    throw new Error("invalid payload");
  }
  const payload = value as Record<string, unknown>;
  const operations = new Set<PublicGatewayOperation>([
    "experience-inquiry",
    "member-application",
    "checkout-draft",
    "stripe-checkout"
  ]);
  if (typeof payload.operation !== "string" || !operations.has(payload.operation as PublicGatewayOperation)) {
    throw new Error("invalid operation");
  }
  if (typeof payload.rateLimitKey !== "string" || !/^[a-f0-9]{64}$/.test(payload.rateLimitKey)) {
    throw new Error("invalid rate-limit key");
  }
  if (!payload.input || typeof payload.input !== "object" || Array.isArray(payload.input)) {
    throw new Error("invalid input");
  }
  return {
    operation: payload.operation as PublicGatewayOperation,
    rateLimitKey: payload.rateLimitKey,
    input: payload.input as Record<string, unknown>
  };
}

function bearerToken(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token || undefined;
}

function publicGatewayFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("different inquiry") ||
    normalized.includes("different member application") ||
    normalized.includes("different draft") ||
    normalized.includes("draft has expired")
  ) {
    return { status: 409, code: "request_conflict", error: message };
  }
  if (
    normalized.includes("is required") ||
    normalized.includes("must be") ||
    normalized.includes("not recognized") ||
    normalized.includes("valid email") ||
    normalized.includes("was not found for this payment attempt") ||
    normalized.includes("cannot create a stripe session") ||
    normalized.includes("origin is not allowed") ||
    normalized.includes("argumentvalidationerror")
  ) {
    return { status: 400, code: "invalid_request", error: "Public gateway request is invalid" };
  }
  if (
    normalized.includes("not configured") ||
    normalized.includes("stripe_secret_key") ||
    normalized.includes("skyla_stripe_mode") ||
    normalized.includes("skyla_payment_return_origins") ||
    normalized.includes("does not match")
  ) {
    return { status: 503, code: "service_unavailable", error: "The service is temporarily unavailable" };
  }
  return { status: 502, code: "upstream_failure", error: "The service could not complete the request" };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
