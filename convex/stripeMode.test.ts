import { describe, expect, it } from "vitest";

import {
  assertStripeSecretMode,
  assertStripeWebhookMode,
  parseStripeMode,
  stripeSecretMode
} from "./lib/stripeMode";

describe("Stripe mode helpers", () => {
  it("requires an explicit test or live mode", () => {
    expect(parseStripeMode("test")).toBe("test");
    expect(parseStripeMode("live")).toBe("live");
    expect(() => parseStripeMode(undefined)).toThrow("SKYLA_STRIPE_MODE is not configured");
    expect(() => parseStripeMode("preview")).toThrow("SKYLA_STRIPE_MODE must be test or live");
  });

  it("keeps Stripe secret keys in the selected mode", () => {
    expect(stripeSecretMode("sk_test_123")).toBe("test");
    expect(stripeSecretMode("sk_live_123")).toBe("live");
    expect(stripeSecretMode("pk_test_123")).toBeUndefined();
    expect(() => assertStripeSecretMode("sk_live_123", "test")).toThrow(
      "STRIPE_SECRET_KEY does not match SKYLA_STRIPE_MODE"
    );
  });

  it("rejects webhooks from the wrong Stripe mode", () => {
    expect(() => assertStripeWebhookMode({ livemode: false }, "test")).not.toThrow();
    expect(() => assertStripeWebhookMode({ livemode: true }, "live")).not.toThrow();
    expect(() => assertStripeWebhookMode({ livemode: true }, "test")).toThrow(
      "Stripe webhook livemode does not match SKYLA_STRIPE_MODE"
    );
    expect(() => assertStripeWebhookMode({}, "test")).toThrow("Stripe webhook livemode is missing");
  });
});
