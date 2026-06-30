export const stripeApiVersion = "2026-02-25.clover";
export const stripeApiBaseUrl = "https://api.stripe.com/v1";

const checkoutSessionPlaceholder = "{CHECKOUT_SESSION_ID}";
const maxStripeNameLength = 120;
const maxStripeLineItems = 100;

export type StripeCheckoutLine = {
  name: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
};

export type StripeCheckoutSnapshot = {
  orderRef: string;
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  customerEmailLower?: string;
  visitDate?: string;
  entryTime?: string;
  lines: StripeCheckoutLine[];
};

export type StripeCheckoutUrls = {
  successUrl: string;
  cancelUrl: string;
};

export type StripeReturnUrlLabel = "successUrl" | "cancelUrl";

export type StripeCheckoutSessionRequest = {
  endpoint: "/checkout/sessions";
  apiVersion: typeof stripeApiVersion;
  idempotencyKey: string;
  body: URLSearchParams;
};

export type StripeCheckoutSessionResponse = {
  id?: string;
  object?: string;
  url?: string;
  payment_status?: string;
  status?: string;
  amount_total?: number;
  currency?: string;
  metadata?: Record<string, string>;
  error?: {
    message?: string;
    type?: string;
  };
  [key: string]: unknown;
};

export function stripeCheckoutIdempotencyKey(orderRef: string) {
  const ref = orderRef.trim();
  if (!ref) {
    throw new Error("orderRef is required");
  }
  return `skyla:checkout-session:${ref}`;
}

export function buildStripeCheckoutSessionRequest(
  snapshot: StripeCheckoutSnapshot,
  urls: StripeCheckoutUrls
): StripeCheckoutSessionRequest {
  const successUrl = normalizeStripeReturnUrl(urls.successUrl, "successUrl");
  const cancelUrl = normalizeStripeReturnUrl(urls.cancelUrl, "cancelUrl");
  const checkoutLines = stripeCheckoutLineItems(snapshot);
  const params = new URLSearchParams();

  params.set("mode", "payment");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("client_reference_id", snapshot.orderRef);
  params.set("metadata[order_ref]", snapshot.orderRef);
  params.set("metadata[source]", "convex");
  if (snapshot.visitDate) {
    params.set("metadata[visit_date]", snapshot.visitDate);
  }
  if (snapshot.entryTime) {
    params.set("metadata[entry_time]", snapshot.entryTime);
  }
  if (snapshot.customerEmailLower) {
    params.set("customer_email", snapshot.customerEmailLower);
  }

  checkoutLines.forEach((line, index) => {
    params.set(`line_items[${index}][quantity]`, String(line.quantity));
    params.set(`line_items[${index}][price_data][currency]`, snapshot.currency);
    params.set(`line_items[${index}][price_data][unit_amount]`, String(line.unitAmountCents));
    params.set(`line_items[${index}][price_data][product_data][name]`, line.name);
  });

  return {
    endpoint: "/checkout/sessions",
    apiVersion: stripeApiVersion,
    idempotencyKey: stripeCheckoutIdempotencyKey(snapshot.orderRef),
    body: params
  };
}

export function stripeCheckoutLineItems(snapshot: StripeCheckoutSnapshot) {
  if (snapshot.currency !== "usd") {
    throw new Error("Stripe checkout currently supports USD orders only");
  }
  if (!Number.isInteger(snapshot.totalCents) || snapshot.totalCents < 50) {
    throw new Error("Stripe checkout total must be at least 50 cents");
  }
  if (!snapshot.lines.length) {
    throw new Error("Stripe checkout requires at least one stored line item");
  }

  const storedLines = snapshot.lines.map((line) => normalizeLine(line));
  const subtotalCents = storedLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (subtotalCents !== snapshot.subtotalCents) {
    throw new Error("Stored line items do not match order subtotal");
  }

  const checkoutLines = storedLines.map(({ lineTotalCents: _lineTotalCents, ...line }) => line);
  if (snapshot.feeCents > 0) {
    checkoutLines.push({
      name: "Online booking fee",
      quantity: 1,
      unitAmountCents: snapshot.feeCents
    });
  }

  if (checkoutLines.length > maxStripeLineItems) {
    throw new Error(`Stripe checkout supports at most ${maxStripeLineItems} line items`);
  }

  const totalCents = checkoutLines.reduce((sum, line) => sum + line.quantity * line.unitAmountCents, 0);
  if (totalCents !== snapshot.totalCents) {
    throw new Error("Stripe checkout lines do not match order total");
  }

  return checkoutLines;
}

export function normalizeStripeReturnUrl(value: string, label: "successUrl" | "cancelUrl") {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.replaceAll(checkoutSessionPlaceholder, "cs_test_placeholder"));
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error(`${label} must use https outside localhost`);
  }

  return trimmed;
}

export function parseStripeReturnOriginAllowlist(value: string | undefined) {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeAllowedOrigin(origin));

  if (!origins.length) {
    throw new Error("SKYLA_PAYMENT_RETURN_ORIGINS must list at least one allowed Stripe return origin");
  }

  return [...new Set(origins)];
}

export function assertStripeReturnOriginAllowed(
  value: string,
  label: StripeReturnUrlLabel,
  allowedOrigins: readonly string[]
) {
  const normalizedUrl = normalizeStripeReturnUrl(value, label);
  const parsed = new URL(normalizedUrl.replaceAll(checkoutSessionPlaceholder, "cs_test_placeholder"));

  if (!allowedOrigins.includes(parsed.origin)) {
    throw new Error(`${label} origin is not allowed for Stripe checkout`);
  }

  return normalizedUrl;
}

export function stripeSessionErrorMessage(data: StripeCheckoutSessionResponse) {
  return data.error?.message ?? "Stripe checkout session request failed";
}

export function sanitizeStripeCheckoutSession(data: StripeCheckoutSessionResponse) {
  return withoutUndefined({
    id: stringValue(data.id),
    object: stringValue(data.object),
    url: stringValue(data.url),
    status: stringValue(data.status),
    payment_status: stringValue(data.payment_status),
    amount_total: numberValue(data.amount_total),
    currency: stringValue(data.currency),
    metadata: data.metadata
  });
}

function normalizeLine(line: StripeCheckoutLine) {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new Error("Stripe checkout line quantity must be a positive integer");
  }
  if (!Number.isInteger(line.unitAmountCents) || line.unitAmountCents < 50) {
    throw new Error("Stripe checkout line unit amount must be at least 50 cents");
  }
  if (line.quantity * line.unitAmountCents !== line.lineTotalCents) {
    throw new Error("Stripe checkout line total is inconsistent");
  }

  return {
    name: normalizeStripeName(line.name),
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    lineTotalCents: line.lineTotalCents
  };
}

function normalizeAllowedOrigin(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SKYLA_PAYMENT_RETURN_ORIGINS must contain absolute origins");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("SKYLA_PAYMENT_RETURN_ORIGINS entries must be origins, not full paths");
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error("SKYLA_PAYMENT_RETURN_ORIGINS must use https outside localhost");
  }

  return parsed.origin;
}

function normalizeStripeName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Skyla ticket";
  }
  return normalized.slice(0, maxStripeNameLength);
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
