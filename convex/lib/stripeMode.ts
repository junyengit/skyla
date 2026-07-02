export type StripeMode = "test" | "live";

export function parseStripeMode(value: string | undefined, envName = "SKYLA_STRIPE_MODE"): StripeMode {
  const mode = value?.trim();
  if (!mode) {
    throw new Error(`${envName} is not configured`);
  }
  if (mode === "test" || mode === "live") {
    return mode;
  }
  throw new Error(`${envName} must be test or live`);
}

export function stripeSecretMode(secretKey: string): StripeMode | undefined {
  if (secretKey.startsWith("sk_test_")) {
    return "test";
  }
  if (secretKey.startsWith("sk_live_")) {
    return "live";
  }
  return undefined;
}

export function assertStripeSecretMode(secretKey: string, expectedMode: StripeMode) {
  const actualMode = stripeSecretMode(secretKey);
  if (!actualMode) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test or live secret key");
  }
  if (actualMode !== expectedMode) {
    throw new Error("STRIPE_SECRET_KEY does not match SKYLA_STRIPE_MODE");
  }
}

export function assertStripeWebhookMode(event: { livemode?: boolean }, expectedMode: StripeMode) {
  if (typeof event.livemode !== "boolean") {
    throw new Error("Stripe webhook livemode is missing");
  }
  if (event.livemode !== (expectedMode === "live")) {
    throw new Error("Stripe webhook livemode does not match SKYLA_STRIPE_MODE");
  }
}
