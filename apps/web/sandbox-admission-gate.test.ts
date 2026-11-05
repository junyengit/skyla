import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@skyla/config";
import { currentCheckoutLegalAcceptanceInput } from "@skyla/payments";

import { POST as createCheckoutDraft } from "./app/api/order-drafts/checkout/route";
import { POST as releaseCheckoutDraft } from "./app/api/order-drafts/checkout/release/route";
import { POST as startStripeCheckout } from "./app/api/payments/stripe-checkout/route";
import {
  sandboxAdmissionDecision,
  sandboxPurchaseRequestAllowed,
  verifiedSandboxAdmissionOrigin
} from "./lib/sandbox-admission";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

// Test fixtures only: hosts shaped like Junyen's Vercel generated URLs. They
// are not the deployed Preview hostnames, which the source never guesses.
const fixtureBranchHost = "web-git-sandbox-fixture-junyen-enterprises.vercel.app";
const fixtureOrigin = `https://${fixtureBranchHost}`;
const fixtureUniqueHost = "web-a1b2c3d4e-junyen-enterprises.vercel.app";

const insideWindow = Date.parse("2026-10-10T18:00:00Z");
const cutoff = Date.parse("2026-10-12T04:00:00Z");
const gatewaySecret = "sandbox-gateway-test-secret-32-chars";
const pinnedGateway = "https://bold-reindeer-495.convex.site/public-gateway";

const verifiedEnv: Record<string, string | undefined> = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_PROJECT_ID: "prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr",
  VERCEL_GIT_COMMIT_REF: "codex/skydeck-sandbox-gate-20261003",
  VERCEL_BRANCH_URL: fixtureBranchHost,
  VERCEL_URL: fixtureUniqueHost,
  VERCEL_PROJECT_PRODUCTION_URL: "skydeckla.com",
  SKYLA_SANDBOX_ADMISSION: "bold-reindeer-495",
  SKYLA_SANDBOX_ADMISSION_ORIGIN: fixtureOrigin,
  SKYLA_PUBLIC_ORIGIN: fixtureOrigin,
  SKYLA_STRIPE_MODE: "test",
  CONVEX_SITE_URL: "https://bold-reindeer-495.convex.site",
  CONVEX_URL: undefined,
  NEXT_PUBLIC_CONVEX_URL: "https://bold-reindeer-495.convex.cloud"
};

function stubSandboxEnv(overrides: Record<string, string | undefined> = {}) {
  const env = { ...verifiedEnv, SKYLA_PUBLIC_GATEWAY_SECRET: gatewaySecret, ...overrides };
  // An empty value is "unset" to both the gate and the gateway client.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(insideWindow);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("sandbox admission web decision", () => {
  it("opens only for the verified Preview with the approved branch origin", () => {
    expect(siteConfig.launched).toBe(false);
    expect(sandboxAdmissionDecision(verifiedEnv, insideWindow)).toEqual({ open: true, origin: fixtureOrigin });
  });

  it.each([
    ["only CONVEX_URL", { CONVEX_SITE_URL: undefined, NEXT_PUBLIC_CONVEX_URL: undefined, CONVEX_URL: "https://bold-reindeer-495.convex.cloud" }],
    ["only NEXT_PUBLIC_CONVEX_URL", { CONVEX_SITE_URL: undefined }],
    ["every slot pinned", { CONVEX_URL: "https://bold-reindeer-495.convex.cloud" }]
  ])("accepts the pinned pair through %s", (_label, overrides) => {
    expect(sandboxAdmissionDecision({ ...verifiedEnv, ...overrides }, insideWindow).open).toBe(true);
  });

  it.each([
    ["no opt-in", { SKYLA_SANDBOX_ADMISSION: undefined }, "not_opted_in"],
    ["a generic opt-in", { SKYLA_SANDBOX_ADMISSION: "1" }, "not_opted_in"],
    ["an opt-in naming the revoked Preview", { SKYLA_SANDBOX_ADMISSION: "grand-ferret-807" }, "not_opted_in"],
    ["local development", { NODE_ENV: "development", VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined }, "not_vercel_preview"],
    ["local development with pulled Preview variables", { NODE_ENV: "development" }, "not_vercel_preview"],
    ["outside Vercel", { VERCEL: undefined }, "not_vercel_preview"],
    ["Vercel production", { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, "not_vercel_preview"],
    ["a production target behind a preview label", { VERCEL_TARGET_ENV: "production" }, "not_vercel_preview"],
    ["vercel dev", { VERCEL_ENV: "development", VERCEL_TARGET_ENV: "development" }, "not_vercel_preview"],
    ["a custom environment", { VERCEL_TARGET_ENV: "staging" }, "not_vercel_preview"],
    ["another Vercel project", { VERCEL_PROJECT_ID: "prj_other" }, "wrong_vercel_project"],
    ["a missing project id", { VERCEL_PROJECT_ID: undefined }, "wrong_vercel_project"],
    ["the main branch", { VERCEL_GIT_COMMIT_REF: "main" }, "wrong_branch"],
    ["a missing branch", { VERCEL_GIT_COMMIT_REF: undefined }, "wrong_branch"],
    ["Stripe live mode", { SKYLA_STRIPE_MODE: "live" }, "stripe_not_test"],
    ["no Stripe mode", { SKYLA_STRIPE_MODE: undefined }, "stripe_not_test"],
    ["a padded Stripe mode", { SKYLA_STRIPE_MODE: " test" }, "stripe_not_test"],
    ["no gateway target", { CONVEX_SITE_URL: undefined, NEXT_PUBLIC_CONVEX_URL: undefined }, "backend_unpinned"],
    ["the revoked October 3 Preview", { CONVEX_SITE_URL: "https://grand-ferret-807.convex.site", NEXT_PUBLIC_CONVEX_URL: "https://grand-ferret-807.convex.cloud" }, "rejected_backend"],
    ["the original Development backend", { CONVEX_SITE_URL: undefined, NEXT_PUBLIC_CONVEX_URL: "https://disciplined-chickadee-688.convex.cloud" }, "rejected_backend"],
    ["the original Production backend", { CONVEX_SITE_URL: "https://perceptive-fox-396.convex.site" }, "rejected_backend"],
    ["an unrecognized backend", { CONVEX_SITE_URL: "https://quiet-otter-123.convex.site", NEXT_PUBLIC_CONVEX_URL: undefined }, "backend_unpinned"],
    ["a CONVEX_URL override to Production", { CONVEX_URL: "https://perceptive-fox-396.convex.cloud" }, "rejected_backend"],
    ["a site override that differs from the pinned cloud URL", { CONVEX_SITE_URL: "https://quiet-otter-123.convex.site" }, "backend_unpinned"],
    ["a cloud override that differs from the pinned site URL", { CONVEX_URL: "https://quiet-otter-123.convex.cloud" }, "backend_unpinned"],
    ["a local Convex site", { CONVEX_SITE_URL: "http://127.0.0.1:3211" }, "backend_unpinned"],
    ["the pinned site over http", { CONVEX_SITE_URL: "http://bold-reindeer-495.convex.site" }, "backend_unpinned"],
    ["the pinned site with a path", { CONVEX_SITE_URL: "https://bold-reindeer-495.convex.site/" }, "backend_unpinned"],
    ["the cloud URL in the site slot", { CONVEX_SITE_URL: "https://bold-reindeer-495.convex.cloud" }, "backend_unpinned"],
    ["a padded site URL", { CONVEX_SITE_URL: " https://bold-reindeer-495.convex.site" }, "backend_unpinned"],
    ["a placeholder site URL", { CONVEX_SITE_URL: "undefined" }, "backend_unpinned"],
    ["no configured origin", { SKYLA_SANDBOX_ADMISSION_ORIGIN: undefined }, "origin_unapproved"],
    ["no branch URL", { VERCEL_BRANCH_URL: undefined }, "origin_unapproved"],
    ["an origin for another branch", { VERCEL_BRANCH_URL: "web-git-other-branch-junyen-enterprises.vercel.app" }, "origin_unapproved"],
    ["the unique deployment URL as the origin", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `https://${fixtureUniqueHost}`, SKYLA_PUBLIC_ORIGIN: `https://${fixtureUniqueHost}` }, "origin_unapproved"],
    ["a branch URL that is also the unique deployment URL", { VERCEL_URL: fixtureBranchHost }, "origin_unapproved"],
    ["a branch URL that is also the production URL", { VERCEL_PROJECT_PRODUCTION_URL: fixtureBranchHost }, "origin_unapproved"],
    ["the production custom domain", { SKYLA_SANDBOX_ADMISSION_ORIGIN: "https://skydeckla.com", VERCEL_BRANCH_URL: "skydeckla.com", SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com" }, "origin_unapproved"],
    ["localhost", { SKYLA_SANDBOX_ADMISSION_ORIGIN: "http://localhost:3000", VERCEL_BRANCH_URL: "localhost:3000", SKYLA_PUBLIC_ORIGIN: "http://localhost:3000" }, "origin_unapproved"],
    ["a trailing slash", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `${fixtureOrigin}/`, VERCEL_BRANCH_URL: `${fixtureBranchHost}/` }, "origin_unapproved"],
    ["an explicit port", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `${fixtureOrigin}:443`, VERCEL_BRANCH_URL: `${fixtureBranchHost}:443` }, "origin_unapproved"],
    ["uppercase spelling", { SKYLA_SANDBOX_ADMISSION_ORIGIN: fixtureOrigin.toUpperCase() }, "origin_unapproved"],
    ["a list of origins", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `${fixtureOrigin},https://skydeckla.com` }, "origin_unapproved"],
    ["a ticket origin pointing at production", { SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com" }, "public_origin_mismatch"],
    ["no ticket origin", { SKYLA_PUBLIC_ORIGIN: undefined }, "public_origin_mismatch"]
  ] as const)("stays closed for %s", (_label, overrides, reason) => {
    expect(sandboxAdmissionDecision({ ...verifiedEnv, ...overrides }, insideWindow)).toEqual({ open: false, reason });
  });

  it.each([
    ["at the reviewed cutoff", cutoff],
    ["after the cutoff", cutoff + 60_000],
    ["with an invalid clock", Number.NaN]
  ])("stays closed %s", (_label, now) => {
    expect(sandboxAdmissionDecision(verifiedEnv, now)).toEqual({ open: false, reason: "expired" });
  });

  it("confirms the gateway client resolves to the pinned backend", () => {
    stubSandboxEnv();
    expect(verifiedSandboxAdmissionOrigin()).toBe(fixtureOrigin);
    stubSandboxEnv({ SKYLA_STRIPE_MODE: "live" });
    expect(verifiedSandboxAdmissionOrigin()).toBeUndefined();
  });
});

const handlers = [
  {
    label: "checkout draft",
    handler: createCheckoutDraft,
    path: "/api/order-drafts/checkout",
    operation: "checkout-draft",
    body: {
      packageKey: "general",
      adults: 1,
      visitDate: "2026-10-10",
      entryTime: "14:00",
      customerEmail: "guest@example.com",
      idempotencyKey: "checkout_sandbox_0001"
    },
    result: {
      orderRef: "SKY2610-SANDBOX",
      status: "draft",
      totals: { currency: "usd", subtotalCents: 2000, feeCents: 0, totalCents: 2000 },
      expiresAt: insideWindow + 15 * 60_000,
      lines: []
    }
  },
  {
    label: "checkout draft release",
    handler: releaseCheckoutDraft,
    path: "/api/order-drafts/checkout/release",
    operation: "checkout-draft-release",
    body: { orderRef: "SKY2610-SANDBOX", idempotencyKey: "checkout_sandbox_0001" },
    result: { released: true }
  },
  {
    label: "Stripe Checkout",
    handler: startStripeCheckout,
    path: "/api/payments/stripe-checkout",
    operation: "stripe-checkout",
    body: {
      orderRef: "SKY2610-SANDBOX",
      idempotencyKey: "checkout_sandbox_0001",
      legalAcceptance: currentCheckoutLegalAcceptanceInput
    },
    result: {
      orderRef: "SKY2610-SANDBOX",
      provider: "stripe",
      checkoutSessionId: "cs_test_sandbox_fixture",
      url: "https://checkout.stripe.com/c/pay/cs_test_sandbox_fixture",
      amountCents: 2000,
      currency: "usd"
    }
  }
] as const;

type Handler = (typeof handlers)[number];

function purchaseRequest(
  route: Handler,
  headers: Record<string, string | undefined> = {},
  options: { url?: string; body?: string } = {}
) {
  const merged: Record<string, string | undefined> = {
    "content-type": "application/json",
    "x-vercel-forwarded-for": "203.0.113.12",
    origin: fixtureOrigin,
    ...headers
  };
  return new Request(options.url ?? `${fixtureOrigin}${route.path}`, {
    method: "POST",
    headers: Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    body: options.body ?? JSON.stringify(route.body)
  });
}

async function expectOriginRejected(response: Response) {
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    error: "Test checkout accepts requests only from its approved preview address.",
    code: "sandbox_origin_rejected"
  });
  expect(fetchMock).not.toHaveBeenCalled();
}

async function expectNotLive(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    error: siteConfig.launchStatus.message,
    code: "ticket_sales_not_live"
  });
  expect(fetchMock).not.toHaveBeenCalled();
}

describe.each(handlers)("sandbox $label route", (route) => {
  it("forwards a verified same-origin request only to the pinned backend", async () => {
    stubSandboxEnv();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: route.result }));

    const response = await route.handler(purchaseRequest(route));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(pinnedGateway);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${gatewaySecret}`);
    const forwarded = JSON.parse(String(init?.body)) as { operation: string; input: Record<string, unknown> };
    expect(forwarded.operation).toBe(route.operation);
    if (route.operation === "stripe-checkout") {
      expect(forwarded.input.successUrl).toBe(`${fixtureOrigin}/checkout?stripe=success&session_id={CHECKOUT_SESSION_ID}`);
      expect(forwarded.input.cancelUrl).toBe(`${fixtureOrigin}/checkout?stripe=cancel`);
    }
  });

  it("accepts Vercel forwarding headers that agree with the approved origin", async () => {
    stubSandboxEnv();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: route.result }));

    const response = await route.handler(purchaseRequest(route, {
      "x-forwarded-host": fixtureBranchHost,
      "x-forwarded-proto": "https",
      forwarded: `for=203.0.113.12;host=${fixtureBranchHost};proto=https`
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["a missing Origin", undefined],
    ["a null Origin", "null"],
    ["an empty Origin", ""],
    ["a trailing slash", `${fixtureOrigin}/`],
    ["uppercase spelling", fixtureOrigin.toUpperCase()],
    ["an explicit default port", `${fixtureOrigin}:443`],
    ["a path", `${fixtureOrigin}/checkout`],
    ["a query", `${fixtureOrigin}?stripe=success`],
    ["a fragment", `${fixtureOrigin}#tickets`],
    ["credentials", `https://guest:pw@${fixtureBranchHost}`],
    ["a list", `${fixtureOrigin}, ${fixtureOrigin}`],
    ["http", `http://${fixtureBranchHost}`],
    ["the unique deployment URL", `https://${fixtureUniqueHost}`],
    ["the production domain", "https://skydeckla.com"],
    ["localhost", "http://localhost:3000"],
    ["garbage", "not a url"]
  ])("rejects %s before parsing or forwarding", async (_label, origin) => {
    stubSandboxEnv();
    const response = await route.handler(purchaseRequest(route, { origin }, { body: "{not json" }));
    await expectOriginRejected(response);
  });

  it.each([
    ["the unique deployment URL", `https://${fixtureUniqueHost}${route.path}`],
    ["the production domain", `https://skydeckla.com${route.path}`],
    ["another port", `https://${fixtureBranchHost}:8443${route.path}`],
    ["http", `http://${fixtureBranchHost}${route.path}`]
  ])("rejects a request addressed to %s even with the approved Origin", async (_label, url) => {
    stubSandboxEnv();
    const response = await route.handler(purchaseRequest(route, {}, { url }));
    await expectOriginRejected(response);
  });

  it.each([
    ["forwarded headers standing in for a missing Origin", {
      origin: undefined,
      "x-forwarded-host": fixtureBranchHost,
      "x-forwarded-proto": "https",
      forwarded: `host=${fixtureBranchHost};proto=https`
    }],
    ["an X-Forwarded-Host for another alias", { "x-forwarded-host": fixtureUniqueHost }],
    ["an X-Forwarded-Host for production", { "x-forwarded-host": "skydeckla.com" }],
    ["an X-Forwarded-Proto of http", { "x-forwarded-proto": "http" }],
    ["a Forwarded host for production", { forwarded: "for=203.0.113.12;host=skydeckla.com;proto=https" }],
    ["a quoted Forwarded host for another alias", { forwarded: `host="${fixtureUniqueHost}"` }],
    ["a Forwarded proto of http", { forwarded: `host=${fixtureBranchHost};proto=http` }],
    ["a malformed Forwarded header", { forwarded: "host" }]
  ])("rejects %s", async (_label, headers) => {
    stubSandboxEnv();
    const response = await route.handler(purchaseRequest(route, headers));
    await expectOriginRejected(response);
  });

  it.each([
    ["Vercel production", { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }],
    ["local development", { NODE_ENV: "development", VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined }],
    ["no opt-in", { SKYLA_SANDBOX_ADMISSION: undefined }],
    ["the revoked October 3 Preview", { CONVEX_SITE_URL: "https://grand-ferret-807.convex.site", NEXT_PUBLIC_CONVEX_URL: "https://grand-ferret-807.convex.cloud" }],
    ["the original Production backend", { CONVEX_SITE_URL: "https://perceptive-fox-396.convex.site", NEXT_PUBLIC_CONVEX_URL: "https://perceptive-fox-396.convex.cloud" }],
    ["a conflicting CONVEX_URL override", { CONVEX_URL: "https://disciplined-chickadee-688.convex.cloud" }],
    ["Stripe live mode", { SKYLA_STRIPE_MODE: "live" }],
    ["a mismatched configured origin", { SKYLA_SANDBOX_ADMISSION_ORIGIN: `https://${fixtureUniqueHost}` }]
  ])("keeps the production gate on %s even for a perfect browser request", async (_label, overrides) => {
    stubSandboxEnv(overrides);
    const response = await route.handler(purchaseRequest(route));
    await expectNotLive(response);
  });

  it("closes again at the reviewed cutoff", async () => {
    stubSandboxEnv();
    vi.setSystemTime(cutoff);
    const response = await route.handler(purchaseRequest(route));
    await expectNotLive(response);
  });
});

describe("sandbox keeps existing gateway protections", () => {
  const draft = handlers[0];

  it("passes the backend's rate limit through unchanged", async () => {
    stubSandboxEnv();
    fetchMock.mockResolvedValueOnce(Response.json(
      { ok: false, code: "rate_limited", error: "Too many requests. Please try again later.", retryAfterSeconds: 42 },
      { status: 429 }
    ));

    const response = await draft.handler(purchaseRequest(draft));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({ code: "rate_limited", persisted: false });
  });

  it("passes the backend's bearer rejection through unchanged", async () => {
    stubSandboxEnv();
    fetchMock.mockResolvedValueOnce(Response.json(
      { ok: false, code: "public_gateway_unauthorized", error: "Public gateway authorization failed" },
      { status: 401 }
    ));

    const response = await draft.handler(purchaseRequest(draft));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "public_gateway_unauthorized" });
  });

  it("still requires the server gateway secret", async () => {
    stubSandboxEnv({ SKYLA_PUBLIC_GATEWAY_SECRET: undefined });

    const response = await draft.handler(purchaseRequest(draft));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "public_gateway_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still requires Vercel's client address for rate limiting", async () => {
    stubSandboxEnv();

    const response = await draft.handler(purchaseRequest(draft, { "x-vercel-forwarded-for": undefined }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "trusted_client_address_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sandbox request origin guard", () => {
  it("rejects credentials in the request URL", () => {
    const request = {
      url: `https://guest:pw@${fixtureBranchHost}/api/payments/stripe-checkout`,
      headers: new Headers({ origin: fixtureOrigin })
    } as Request;
    expect(sandboxPurchaseRequestAllowed(request, fixtureOrigin)).toBe(false);
  });

  it("rejects an unparseable request URL", () => {
    const request = { url: "not a url", headers: new Headers({ origin: fixtureOrigin }) } as Request;
    expect(sandboxPurchaseRequestAllowed(request, fixtureOrigin)).toBe(false);
  });
});
