import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@skyla/config";

import { publicGateway } from "./http";
import { backendSandboxAdmissionDecision } from "./lib/sandboxAdmission";

declare const process: { env: Record<string, string | undefined> };

// Test fixture only: shaped like Junyen's Vercel Git-branch hosts. It is not
// the deployed Preview hostname, which the source never guesses.
const fixtureOrigin = "https://web-git-sandbox-fixture-junyen-enterprises.vercel.app";
const insideWindow = Date.parse("2026-10-10T18:00:00Z");
const cutoff = Date.parse("2026-10-12T04:00:00Z");
const gatewaySecret = "convex-sandbox-gateway-secret-32-chars";
const rateLimitKey = "a".repeat(64);
const handler = (publicGateway as unknown as {
  _handler: (ctx: unknown, request: Request) => Promise<Response>;
})._handler;

const verifiedEnv: Record<string, string | undefined> = {
  SKYLA_SANDBOX_ADMISSION: "bold-reindeer-495",
  CONVEX_CLOUD_URL: "https://bold-reindeer-495.convex.cloud",
  CONVEX_SITE_URL: "https://bold-reindeer-495.convex.site",
  SKYLA_STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_...sandbox_fixture",
  SKYLA_SANDBOX_ADMISSION_ORIGIN: fixtureOrigin,
  SKYLA_PUBLIC_ORIGIN: fixtureOrigin,
  SKYLA_PAYMENT_RETURN_ORIGINS: fixtureOrigin
};

const managedKeys = [...Object.keys(verifiedEnv), "SKYLA_PUBLIC_GATEWAY_SECRET"];
const savedEnv = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...verifiedEnv, SKYLA_PUBLIC_GATEWAY_SECRET: gatewaySecret, ...overrides };
  for (const key of managedKeys) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(insideWindow);
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of managedKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

type Operation = "checkout-draft" | "checkout-draft-release" | "stripe-checkout";

const inputs: Record<Operation, Record<string, unknown>> = {
  "checkout-draft": { packageKey: "general", adults: 1, idempotencyKey: "checkout_sandbox_0001" },
  "checkout-draft-release": { orderRef: "SKY2610-SANDBOX", idempotencyKey: "checkout_sandbox_0001" },
  "stripe-checkout": {
    orderRef: "SKY2610-SANDBOX",
    idempotencyKey: "checkout_sandbox_0001",
    successUrl: `${fixtureOrigin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${fixtureOrigin}/checkout?stripe=cancel`
  }
};

function request(operation: Operation, options: { secret?: string; body?: string } = {}) {
  return new Request("https://bold-reindeer-495.convex.site/public-gateway", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.secret ?? gatewaySecret}`,
      "Content-Type": "application/json"
    },
    body: options.body ?? JSON.stringify({ operation, rateLimitKey, input: inputs[operation] })
  });
}

function dispatchContext() {
  return {
    runMutation: vi.fn().mockResolvedValue({ ok: "mutation" }),
    runAction: vi.fn().mockResolvedValue({ ok: "action" })
  };
}

describe("backend sandbox admission decision", () => {
  it("opens only on the pinned Preview with test Stripe and one approved origin", () => {
    expect(siteConfig.launched).toBe(false);
    expect(backendSandboxAdmissionDecision(verifiedEnv, insideWindow)).toEqual({ open: true });
  });

  it.each([
    ["no opt-in", { SKYLA_SANDBOX_ADMISSION: undefined }, "not_opted_in"],
    ["a generic opt-in", { SKYLA_SANDBOX_ADMISSION: "1" }, "not_opted_in"],
    ["the revoked October 3 Preview", { CONVEX_CLOUD_URL: "https://grand-ferret-807.convex.cloud", CONVEX_SITE_URL: "https://grand-ferret-807.convex.site" }, "rejected_backend"],
    ["the original Development backend", { CONVEX_CLOUD_URL: "https://disciplined-chickadee-688.convex.cloud", CONVEX_SITE_URL: "https://disciplined-chickadee-688.convex.site" }, "rejected_backend"],
    ["the original Production backend", { CONVEX_CLOUD_URL: "https://perceptive-fox-396.convex.cloud", CONVEX_SITE_URL: "https://perceptive-fox-396.convex.site" }, "rejected_backend"],
    ["an unrecognized backend", { CONVEX_CLOUD_URL: "https://quiet-otter-123.convex.cloud", CONVEX_SITE_URL: "https://quiet-otter-123.convex.site" }, "backend_unpinned"],
    ["a missing system cloud URL", { CONVEX_CLOUD_URL: undefined }, "backend_unpinned"],
    ["a missing system site URL", { CONVEX_SITE_URL: undefined }, "backend_unpinned"],
    ["a mismatched site URL", { CONVEX_SITE_URL: "https://quiet-otter-123.convex.site" }, "backend_unpinned"],
    ["Stripe live mode", { SKYLA_STRIPE_MODE: "live" }, "stripe_not_test"],
    ["no Stripe mode", { SKYLA_STRIPE_MODE: undefined }, "stripe_not_test"],
    ["a live secret key", { STRIPE_SECRET_KEY: "sk_live_...sandbox_fixture" }, "stripe_key_not_test"],
    ["a restricted test key", { STRIPE_SECRET_KEY: "rk_test_...sandbox_fixture" }, "stripe_key_not_test"],
    ["a restricted live key", { STRIPE_SECRET_KEY: "rk_live_...sandbox_fixture" }, "stripe_key_not_test"],
    ["a bare test prefix", { STRIPE_SECRET_KEY: "sk_test_" }, "stripe_key_not_test"],
    ["no secret key", { STRIPE_SECRET_KEY: undefined }, "stripe_key_not_test"],
    ["no sandbox origin", { SKYLA_SANDBOX_ADMISSION_ORIGIN: undefined }, "origin_unapproved"],
    ["the production origin everywhere", { SKYLA_SANDBOX_ADMISSION_ORIGIN: "https://skydeckla.com", SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com", SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com" }, "origin_unapproved"],
    ["localhost everywhere", { SKYLA_SANDBOX_ADMISSION_ORIGIN: "http://localhost:3000", SKYLA_PUBLIC_ORIGIN: "http://localhost:3000", SKYLA_PAYMENT_RETURN_ORIGINS: "http://localhost:3000" }, "origin_unapproved"],
    ["a ticket origin for production", { SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com" }, "origin_unapproved"],
    ["no ticket origin", { SKYLA_PUBLIC_ORIGIN: undefined }, "origin_unapproved"],
    ["a second return origin", { SKYLA_PAYMENT_RETURN_ORIGINS: `${fixtureOrigin},https://skydeckla.com` }, "origin_unapproved"],
    ["a return origin with a trailing slash", { SKYLA_PAYMENT_RETURN_ORIGINS: `${fixtureOrigin}/` }, "origin_unapproved"],
    ["no return origin", { SKYLA_PAYMENT_RETURN_ORIGINS: undefined }, "origin_unapproved"],
    ["an origin with a port", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `${fixtureOrigin}:443`, SKYLA_PUBLIC_ORIGIN: `${fixtureOrigin}:443`, SKYLA_PAYMENT_RETURN_ORIGINS: `${fixtureOrigin}:443` }, "origin_unapproved"]
  ] as const)("stays closed for %s", (_label, overrides, reason) => {
    expect(backendSandboxAdmissionDecision({ ...verifiedEnv, ...overrides }, insideWindow)).toEqual({ open: false, reason });
  });

  it.each([
    ["at the reviewed cutoff", cutoff],
    ["after the cutoff", cutoff + 60_000],
    ["with an invalid clock", Number.NaN]
  ])("stays closed %s", (_label, now) => {
    expect(backendSandboxAdmissionDecision(verifiedEnv, now)).toEqual({ open: false, reason: "expired" });
  });
});

describe("Convex public gateway in the verified sandbox", () => {
  it.each([
    ["checkout-draft", "runMutation"],
    ["checkout-draft-release", "runMutation"],
    ["stripe-checkout", "runAction"]
  ] as const)("dispatches %s with the existing rate-limit key", async (operation, dispatcher) => {
    setEnv();
    const ctx = dispatchContext();

    const response = await handler(ctx, request(operation));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ctx[dispatcher]).toHaveBeenCalledOnce();
    expect(ctx[dispatcher].mock.calls[0]?.[1]).toMatchObject({
      ...inputs[operation],
      gatewayRateLimitKey: rateLimitKey
    });
  });

  it.each([
    ["no opt-in", { SKYLA_SANDBOX_ADMISSION: undefined }],
    ["the revoked October 3 Preview", { CONVEX_CLOUD_URL: "https://grand-ferret-807.convex.cloud", CONVEX_SITE_URL: "https://grand-ferret-807.convex.site" }],
    ["the original Development backend", { CONVEX_CLOUD_URL: "https://disciplined-chickadee-688.convex.cloud", CONVEX_SITE_URL: "https://disciplined-chickadee-688.convex.site" }],
    ["the original Production backend", { CONVEX_CLOUD_URL: "https://perceptive-fox-396.convex.cloud", CONVEX_SITE_URL: "https://perceptive-fox-396.convex.site" }],
    ["Stripe live mode with a live key", { SKYLA_STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_...sandbox_fixture" }],
    ["a restricted key", { STRIPE_SECRET_KEY: "rk_test_...sandbox_fixture" }],
    ["a production return origin", { SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com" }]
  ])("keeps purchases closed on %s", async (_label, overrides) => {
    setEnv(overrides);
    for (const operation of ["checkout-draft", "checkout-draft-release", "stripe-checkout"] as const) {
      const ctx = dispatchContext();
      const response = await handler(ctx, request(operation));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "ticket_sales_not_live",
        error: siteConfig.launchStatus.message
      });
      expect(ctx.runMutation).not.toHaveBeenCalled();
      expect(ctx.runAction).not.toHaveBeenCalled();
    }
  });

  it("closes again at the reviewed cutoff", async () => {
    setEnv();
    vi.setSystemTime(cutoff);
    const ctx = dispatchContext();

    const response = await handler(ctx, request("stripe-checkout"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "ticket_sales_not_live" });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("still rejects a wrong bearer secret before any sandbox decision", async () => {
    setEnv();
    const ctx = dispatchContext();

    const response = await handler(ctx, request("checkout-draft", { secret: `${gatewaySecret}-wrong` }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "public_gateway_unauthorized" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("still enforces the request-size limit", async () => {
    setEnv();
    const ctx = dispatchContext();

    const response = await handler(ctx, request("checkout-draft", { body: "x".repeat(32_769) }));

    expect(response.status).toBe(413);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("still rejects malformed gateway payloads", async () => {
    setEnv();
    const ctx = dispatchContext();

    const response = await handler(ctx, request("checkout-draft", {
      body: JSON.stringify({ operation: "checkout-draft", rateLimitKey: "short", input: inputs["checkout-draft"] })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("still returns the durable rate limit", async () => {
    setEnv();
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(new ConvexError({ code: "rate_limited", retryAfterSeconds: 42 })),
      runAction: vi.fn()
    };

    const response = await handler(ctx, request("checkout-draft"));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 });
  });
});
