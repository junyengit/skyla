const defaultToleranceSeconds = 300;

export type StripeWebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_secret" | "missing_header" | "malformed_header" | "timestamp_outside_tolerance" | "signature_mismatch" };

export type StripeWebhookEvent = {
  id?: string;
  type?: string;
  created?: number;
  livemode?: boolean;
  data?: {
    object?: unknown;
  };
};

export type StripeCheckoutWebhookOutcome =
  | {
      outcome: "paid";
      providerEventId: string;
      eventType: string;
      providerPaymentId: string;
      providerPaymentIntentId: string;
      orderRef: string;
      amountCents: number;
      currency: "usd";
      raw: Record<string, unknown>;
    }
  | {
      outcome: "failed" | "canceled";
      providerEventId: string;
      eventType: string;
      providerPaymentId: string;
      orderRef?: string;
      amountCents?: number;
      currency?: "usd";
      raw: Record<string, unknown>;
    }
  | {
      outcome: "ignored";
      providerEventId: string;
      eventType: string;
      orderRef?: string;
      raw: Record<string, unknown>;
    };

export type StripeTerminalWebhookOutcome =
  | {
      outcome: "paid" | "failed" | "canceled";
      providerEventId: string;
      eventType: string;
      providerPaymentId: string;
      saleRef: string;
      amountCents: number;
      currency: "usd";
      raw: Record<string, unknown>;
    }
  | {
      outcome: "ignored";
      providerEventId: string;
      eventType: string;
      saleRef?: string;
      raw: Record<string, unknown>;
    };

export type StripeRefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

export type StripeRefundWebhookOutcome =
  | {
      outcome: "refund";
      providerEventId: string;
      eventType: string;
      providerRefundId: string;
      providerPaymentIntentId: string;
      status: StripeRefundStatus;
      amountCents: number;
      currency: "usd";
      reason?: string;
      failureReason?: string;
      providerEventCreatedAt: number;
      raw: Record<string, unknown>;
    }
  | {
      outcome: "ignored";
      providerEventId: string;
      eventType: string;
      raw: Record<string, unknown>;
    };

export function stripeRefundWebhookDisposition(status: string) {
  return {
    ok: status !== "failed" && status !== "retryable",
    httpStatus: status === "retryable" ? 503 : 200
  } as const;
}

export function stripeCheckoutOrderStatusAfterUnpaidOutcome(outcome: "failed" | "canceled"): "canceled" | "expired" {
  return outcome === "failed" ? "canceled" : "expired";
}

export function stripeTerminalSaleStatusAfterUnpaidOutcome(outcome: "failed" | "canceled"): "payment_pending" | "canceled" {
  return outcome === "failed" ? "payment_pending" : "canceled";
}

type StripeCheckoutSessionObject = {
  id?: unknown;
  object?: unknown;
  client_reference_id?: unknown;
  metadata?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
  status?: unknown;
  payment_intent?: unknown;
};

type StripeTerminalPaymentIntentObject = {
  id?: unknown;
  object?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  metadata?: unknown;
  latest_charge?: unknown;
};

type StripeRefundObject = {
  id?: unknown;
  object?: unknown;
  payment_intent?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  reason?: unknown;
  failure_reason?: unknown;
  created?: unknown;
};

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  options: { nowMs?: number; toleranceSeconds?: number } = {}
): Promise<StripeWebhookVerification> {
  const cleanSecret = secret?.trim();
  if (!cleanSecret) {
    return { ok: false, reason: "missing_secret" };
  }
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    return { ok: false, reason: signatureHeader ? "malformed_header" : "missing_header" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const toleranceSeconds = options.toleranceSeconds ?? defaultToleranceSeconds;
  if (Math.abs(nowMs / 1000 - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_outside_tolerance" };
  }

  const expected = await hmacSha256Hex(cleanSecret, `${parsed.timestamp}.${rawBody}`);
  const hasMatch = parsed.signatures.some((signature) => timingSafeHexEqual(signature, expected));
  if (!hasMatch) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true, timestamp: parsed.timestamp };
}

export async function stripeWebhookTestSignature(rawBody: string, secret: string, timestamp: number) {
  return `t=${timestamp},v1=${await hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;
}

export function stripeCheckoutOutcomeFromEvent(event: StripeWebhookEvent): StripeCheckoutWebhookOutcome {
  const providerEventId = stringValue(event.id) ?? "missing_event_id";
  const eventType = stringValue(event.type) ?? "unknown";
  const session = checkoutSessionObject(event.data?.object);
  const orderRef = checkoutOrderRef(session);

  if (!event.id || !event.type) {
    return ignored(providerEventId, eventType, orderRef, "missing_event_identity", event, session);
  }
  if (!session || session.object !== "checkout.session") {
    return ignored(providerEventId, eventType, orderRef, "not_checkout_session", event, session);
  }

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (session.payment_status !== "paid") {
      return ignored(providerEventId, eventType, orderRef, "checkout_session_not_paid", event, session);
    }
    const providerPaymentId = stringValue(session.id);
    const providerPaymentIntentId = stringValue(session.payment_intent);
    const amountCents = numberValue(session.amount_total);
    const currency = currencyValue(session.currency);
    if (!providerPaymentId || !providerPaymentIntentId || !orderRef || amountCents === undefined || !currency) {
      return ignored(providerEventId, eventType, orderRef, "missing_checkout_payment_fields", event, session);
    }

    return {
      outcome: "paid",
      providerEventId,
      eventType,
      providerPaymentId,
      providerPaymentIntentId,
      orderRef,
      amountCents,
      currency,
      raw: sanitizedRaw(event, session, "paid")
    };
  }

  if (eventType === "checkout.session.async_payment_failed") {
    const providerPaymentId = stringValue(session.id);
    if (!providerPaymentId) {
      return ignored(providerEventId, eventType, orderRef, "missing_checkout_session_id", event, session);
    }
    return {
      outcome: "failed",
      providerEventId,
      eventType,
      providerPaymentId,
      orderRef,
      amountCents: numberValue(session.amount_total),
      currency: currencyValue(session.currency),
      raw: sanitizedRaw(event, session, "async_payment_failed")
    };
  }

  if (eventType === "checkout.session.expired") {
    const providerPaymentId = stringValue(session.id);
    if (!providerPaymentId) {
      return ignored(providerEventId, eventType, orderRef, "missing_checkout_session_id", event, session);
    }
    return {
      outcome: "canceled",
      providerEventId,
      eventType,
      providerPaymentId,
      orderRef,
      amountCents: numberValue(session.amount_total),
      currency: currencyValue(session.currency),
      raw: sanitizedRaw(event, session, "checkout_expired")
    };
  }

  return ignored(providerEventId, eventType, orderRef, "unsupported_event_type", event, session);
}

export function stripeTerminalPaymentIntentOutcomeFromEvent(event: StripeWebhookEvent): StripeTerminalWebhookOutcome {
  const providerEventId = stringValue(event.id) ?? "missing_event_id";
  const eventType = stringValue(event.type) ?? "unknown";
  const intent = terminalPaymentIntentObject(event.data?.object);
  const saleRef = terminalSaleRef(intent);

  if (!event.id || !event.type) {
    return terminalIgnored(providerEventId, eventType, saleRef, "missing_event_identity", event, intent);
  }
  if (!intent || intent.object !== "payment_intent") {
    return terminalIgnored(providerEventId, eventType, saleRef, "not_payment_intent", event, intent);
  }
  if (terminalMetadataSource(intent) !== "convex-terminal") {
    return terminalIgnored(providerEventId, eventType, saleRef, "not_convex_terminal_source", event, intent);
  }
  if (
    eventType !== "payment_intent.succeeded" &&
    eventType !== "payment_intent.payment_failed" &&
    eventType !== "payment_intent.canceled"
  ) {
    return terminalIgnored(providerEventId, eventType, saleRef, "unsupported_event_type", event, intent);
  }

  const providerPaymentId = stringValue(intent.id);
  const amountCents = numberValue(intent.amount);
  const currency = currencyValue(intent.currency);
  if (!providerPaymentId || !saleRef || amountCents === undefined || !currency) {
    return terminalIgnored(providerEventId, eventType, saleRef, "missing_terminal_payment_fields", event, intent);
  }

  if (eventType === "payment_intent.succeeded") {
    const status = stringValue(intent.status);
    if (status && status !== "succeeded") {
      return terminalIgnored(providerEventId, eventType, saleRef, "payment_intent_status_mismatch", event, intent);
    }
    return {
      outcome: "paid",
      providerEventId,
      eventType,
      providerPaymentId,
      saleRef,
      amountCents,
      currency,
      raw: terminalSanitizedRaw(event, intent, "paid")
    };
  }

  return {
    outcome: eventType === "payment_intent.canceled" ? "canceled" : "failed",
    providerEventId,
    eventType,
    providerPaymentId,
    saleRef,
    amountCents,
    currency,
    raw: terminalSanitizedRaw(event, intent, eventType === "payment_intent.canceled" ? "canceled" : "payment_failed")
  };
}

export function stripeWebhookObjectType(event: StripeWebhookEvent) {
  const object = event.data?.object;
  if (!object || typeof object !== "object") {
    return undefined;
  }
  return stringValue((object as { object?: unknown }).object);
}

export function stripeRefundOutcomeFromEvent(event: StripeWebhookEvent): StripeRefundWebhookOutcome {
  const providerEventId = stringValue(event.id) ?? "missing_event_id";
  const eventType = stringValue(event.type) ?? "unknown";
  const refund = refundObject(event.data?.object);
  const ignoredRefund = (reason: string): StripeRefundWebhookOutcome => ({
    outcome: "ignored",
    providerEventId,
    eventType,
    raw: refundSanitizedRaw(event, refund, reason)
  });

  if (!event.id || !event.type) return ignoredRefund("missing_event_identity");
  if (!refund || refund.object !== "refund") return ignoredRefund("not_refund");
  if (!(["refund.created", "refund.updated", "refund.failed"] as string[]).includes(eventType)) {
    return ignoredRefund("unsupported_event_type");
  }

  const providerRefundId = stringValue(refund.id);
  const providerPaymentIntentId = stringValue(refund.payment_intent);
  const amountCents = numberValue(refund.amount);
  const currency = currencyValue(refund.currency);
  const status = refundStatus(refund.status);
  const providerEventCreatedAt = numberValue(event.created);
  if (
    !providerRefundId ||
    !providerPaymentIntentId ||
    amountCents === undefined ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !currency ||
    !status ||
    providerEventCreatedAt === undefined ||
    !Number.isSafeInteger(providerEventCreatedAt) ||
    providerEventCreatedAt < 0
  ) {
    return ignoredRefund("missing_refund_fields");
  }
  if (eventType === "refund.failed" && status !== "failed") {
    return ignoredRefund("refund_failed_status_mismatch");
  }

  return {
    outcome: "refund",
    providerEventId,
    eventType,
    providerRefundId,
    providerPaymentIntentId,
    status,
    amountCents,
    currency,
    reason: stringValue(refund.reason),
    failureReason: stringValue(refund.failure_reason),
    providerEventCreatedAt: providerEventCreatedAt * 1000,
    raw: refundSanitizedRaw(event, refund, status)
  };
}

function parseStripeSignatureHeader(header: string | null) {
  if (!header) {
    return null;
  }

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const entry of header.split(",")) {
    const separator = entry.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (key === "t") {
      timestamp = Number(value);
    }
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === undefined || !Number.isInteger(timestamp) || !signatures.length) {
    return null;
  }
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeHexEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function checkoutSessionObject(value: unknown): StripeCheckoutSessionObject | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as StripeCheckoutSessionObject;
}

function terminalPaymentIntentObject(value: unknown): StripeTerminalPaymentIntentObject | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as StripeTerminalPaymentIntentObject;
}

function refundObject(value: unknown): StripeRefundObject | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as StripeRefundObject;
}

function refundStatus(value: unknown): StripeRefundStatus | undefined {
  const status = stringValue(value);
  return status && ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(status)
    ? (status as StripeRefundStatus)
    : undefined;
}

function checkoutOrderRef(session: StripeCheckoutSessionObject | undefined) {
  const metadata = session?.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  return stringValue(session?.client_reference_id) ?? stringValue(metadata.order_ref);
}

function terminalSaleRef(intent: StripeTerminalPaymentIntentObject | undefined) {
  const metadata = terminalMetadata(intent);
  return stringValue(metadata.sale_ref);
}

function terminalMetadataSource(intent: StripeTerminalPaymentIntentObject | undefined) {
  return stringValue(terminalMetadata(intent).source);
}

function terminalMetadata(intent: StripeTerminalPaymentIntentObject | undefined) {
  return intent?.metadata && typeof intent.metadata === "object" ? (intent.metadata as Record<string, unknown>) : {};
}

function ignored(
  providerEventId: string,
  eventType: string,
  orderRef: string | undefined,
  reason: string,
  event: StripeWebhookEvent,
  session: StripeCheckoutSessionObject | undefined
): StripeCheckoutWebhookOutcome {
  return {
    outcome: "ignored",
    providerEventId,
    eventType,
    orderRef,
    raw: sanitizedRaw(event, session, reason)
  };
}

function terminalIgnored(
  providerEventId: string,
  eventType: string,
  saleRef: string | undefined,
  reason: string,
  event: StripeWebhookEvent,
  intent: StripeTerminalPaymentIntentObject | undefined
): StripeTerminalWebhookOutcome {
  return {
    outcome: "ignored",
    providerEventId,
    eventType,
    saleRef,
    raw: terminalSanitizedRaw(event, intent, reason)
  };
}

function sanitizedRaw(event: StripeWebhookEvent, session: StripeCheckoutSessionObject | undefined, reason: string) {
  return withoutUndefined({
    reason,
    eventId: stringValue(event.id),
    eventType: stringValue(event.type),
    created: numberValue(event.created),
    livemode: typeof event.livemode === "boolean" ? event.livemode : undefined,
    session: session
      ? withoutUndefined({
          id: stringValue(session.id),
          object: stringValue(session.object),
          client_reference_id: stringValue(session.client_reference_id),
          amount_total: numberValue(session.amount_total),
          currency: stringValue(session.currency),
          payment_status: stringValue(session.payment_status),
          status: stringValue(session.status),
          payment_intent: stringValue(session.payment_intent),
          metadata: metadataSummary(session.metadata)
        })
      : undefined
  });
}

function terminalSanitizedRaw(
  event: StripeWebhookEvent,
  intent: StripeTerminalPaymentIntentObject | undefined,
  reason: string
) {
  return withoutUndefined({
    reason,
    eventId: stringValue(event.id),
    eventType: stringValue(event.type),
    created: numberValue(event.created),
    livemode: typeof event.livemode === "boolean" ? event.livemode : undefined,
    paymentIntent: intent
      ? withoutUndefined({
          id: stringValue(intent.id),
          object: stringValue(intent.object),
          amount: numberValue(intent.amount),
          currency: stringValue(intent.currency),
          status: stringValue(intent.status),
          latest_charge: stringValue(intent.latest_charge),
          metadata: terminalMetadataSummary(intent.metadata)
        })
      : undefined
  });
}

function refundSanitizedRaw(event: StripeWebhookEvent, refund: StripeRefundObject | undefined, reason: string) {
  return withoutUndefined({
    reason,
    eventId: stringValue(event.id),
    eventType: stringValue(event.type),
    created: numberValue(event.created),
    livemode: typeof event.livemode === "boolean" ? event.livemode : undefined,
    refund: refund
      ? withoutUndefined({
          id: stringValue(refund.id),
          object: stringValue(refund.object),
          payment_intent: stringValue(refund.payment_intent),
          amount: numberValue(refund.amount),
          currency: stringValue(refund.currency),
          status: stringValue(refund.status),
          reason: stringValue(refund.reason),
          failure_reason: stringValue(refund.failure_reason),
          created: numberValue(refund.created)
        })
      : undefined
  });
}

function metadataSummary(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const metadata = value as Record<string, unknown>;
  return withoutUndefined({
    order_ref: stringValue(metadata.order_ref),
    source: stringValue(metadata.source),
    visit_date: stringValue(metadata.visit_date),
    entry_time: stringValue(metadata.entry_time)
  });
}

function terminalMetadataSummary(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const metadata = value as Record<string, unknown>;
  return withoutUndefined({
    sale_ref: stringValue(metadata.sale_ref),
    source: stringValue(metadata.source),
    line_count: stringValue(metadata.line_count),
    reader_id: stringValue(metadata.reader_id),
    terminal_location_id: stringValue(metadata.terminal_location_id)
  });
}

function currencyValue(value: unknown): "usd" | undefined {
  return value === "usd" ? "usd" : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
