import { checkoutProviderTimeoutMs } from "./checkoutAttempts";
import { stripeApiBaseUrl } from "./stripeCheckout";
import { assertStripeSecretMode, parseStripeMode, type StripeMode } from "./stripeMode";

declare const process: { env: Record<string, string | undefined> };

export type StripeHttpResponse = { status: number; ok: boolean; body: unknown };

/**
 * One Stripe API request. Returns status and parsed body for every HTTP
 * outcome; throws only when no response arrived (outcome unknown).
 */
export async function stripeRequest(
  path: string,
  options: {
    method: "GET" | "POST";
    secretKey: string;
    apiVersion: string;
    idempotencyKey?: string;
    body?: URLSearchParams;
  }
): Promise<StripeHttpResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.secretKey}`,
    "Stripe-Version": options.apiVersion
  };
  if (options.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const timeout =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(checkoutProviderTimeoutMs)
      : undefined;
  const response = await fetch(`${stripeApiBaseUrl}${path}`, {
    method: options.method,
    headers,
    body: options.body,
    ...(timeout ? { signal: timeout } : {})
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body };
}

/** The configured secret and mode; throws a configuration error otherwise. */
export function configuredStripeSecret(): { secretKey: string; mode: StripeMode } {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  const mode = parseStripeMode(process.env.SKYLA_STRIPE_MODE);
  assertStripeSecretMode(secretKey, mode);
  return { secretKey, mode };
}
