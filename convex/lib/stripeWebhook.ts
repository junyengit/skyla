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

export function stripeCheckoutOrderStatusAfterUnpaidOutcome(outcome: "failed" | "canceled"): "canceled" | "expired" {
  return outcome === "failed" ? "canceled" : "expired";
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
    const amountCents = numberValue(session.amount_total);
    const currency = currencyValue(session.currency);
    if (!providerPaymentId || !orderRef || amountCents === undefined || !currency) {
      return ignored(providerEventId, eventType, orderRef, "missing_checkout_payment_fields", event, session);
    }

    return {
      outcome: "paid",
      providerEventId,
      eventType,
      providerPaymentId,
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

function checkoutOrderRef(session: StripeCheckoutSessionObject | undefined) {
  const metadata = session?.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  return stringValue(session?.client_reference_id) ?? stringValue(metadata.order_ref);
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
