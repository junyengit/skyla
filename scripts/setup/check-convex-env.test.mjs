import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-convex-env.mjs");
const stripeSecretKeyEnv = ["STRIPE", "SECRET_KEY"].join("_");

function runCheck(extraEnv) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv
    },
    encoding: "utf8"
  });
}

function parseStdout(result) {
  return JSON.parse(result.stdout);
}

describe("check-convex-env", () => {
  it("passes selected payment and Terminal gates when every required shape is present", () => {
    const result = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_STRIPE_MODE: "test",
      [stripeSecretKeyEnv]: "sk_test_placeholder",
      SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com,https://www.skydeckla.com",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      SKYLA_TERMINAL_READER_REGISTRY: "tmr_frontdesk@tml_lobby",
      SKYLA_POS_TERMINAL_ACCEPTANCE: "enabled",
      SKYLA_PUBLIC_GATEWAY_SECRET: "0123456789abcdef0123456789abcdef",
      SKYLA_CONVEX_ENV_REQUIRE: "cloud,stripe-checkout,stripe-webhook,terminal-reader"
    });

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.readyForCloudPersistence).toBe(true);
    expect(output.readyForStripeCheckout).toBe(true);
    expect(output.readyForStripeWebhook).toBe(true);
    expect(output.readyForTerminalReaderHandoff).toBe(true);
    expect(output.requiredGates).toEqual([
      { name: "cloud", ok: true },
      { name: "stripe-checkout", ok: true },
      { name: "stripe-webhook", ok: true },
      { name: "terminal-reader", ok: true }
    ]);
  });

  it("requires a strong server-only secret for the public gateway gate", () => {
    const ready = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_PUBLIC_GATEWAY_SECRET: "0123456789abcdef0123456789abcdef",
      SKYLA_CONVEX_ENV_REQUIRE: "public-gateway"
    });
    expect(ready.status).toBe(0);
    expect(parseStdout(ready)).toMatchObject({
      readyForPublicGateway: true,
      requiredGates: [{ name: "public-gateway", ok: true }]
    });

    const weak = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_PUBLIC_GATEWAY_SECRET: "too short",
      SKYLA_CONVEX_ENV_REQUIRE: "public-gateway"
    });
    expect(weak.status).toBe(1);
    expect(parseStdout(weak).readyForPublicGateway).toBe(false);
  });

  it("requires webhook readiness before the Terminal reader gate passes", () => {
    const result = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_STRIPE_MODE: "test",
      [stripeSecretKeyEnv]: "sk_test_placeholder",
      SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com",
      STRIPE_WEBHOOK_SECRET: "",
      SKYLA_TERMINAL_READER_REGISTRY: "tmr_frontdesk@tml_lobby",
      SKYLA_POS_TERMINAL_ACCEPTANCE: "enabled",
      SKYLA_CONVEX_ENV_REQUIRE: "terminal-reader"
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.readyForTerminalReaderHandoff).toBe(false);
    expect(output.requiredGates).toEqual([{ name: "terminal-reader", ok: false }]);
    expect(result.stderr).toContain("One or more required Convex env gates are not ready");
  });

  it("requires a valid Convex-only provider, sender, reply-to, and HTTPS origin for ticket email", () => {
    const ready = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      RESEND_API_KEY: "re_test_placeholder",
      SKYLA_TICKET_FROM_EMAIL: "Sky LA <tickets@skydeckla.com>",
      SKYLA_TICKET_REPLY_TO: "reservations@skydeckla.com",
      SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com",
      SKYLA_CONVEX_ENV_REQUIRE: "ticket-email"
    });
    expect(ready.status).toBe(0);
    expect(parseStdout(ready)).toMatchObject({
      readyForTicketEmail: true,
      requiredGates: [{ name: "ticket-email", ok: true }]
    });

    const unsafeOrigin = runCheck({
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      RESEND_API_KEY: "re_test_placeholder",
      SKYLA_TICKET_FROM_EMAIL: "tickets@skydeckla.com",
      SKYLA_PUBLIC_ORIGIN: "http://skydeckla.com/tickets",
      SKYLA_CONVEX_ENV_REQUIRE: "ticket-email"
    });
    expect(unsafeOrigin.status).toBe(1);
    expect(parseStdout(unsafeOrigin)).toMatchObject({ readyForTicketEmail: false });
  });

  it("does not echo arbitrary unknown gate names from the environment", () => {
    const result = runCheck({
      SKYLA_CONVEX_ENV_REQUIRE: "not-a-real-gate"
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.unknownRequiredGateCount).toBe(1);
    expect(result.stderr).toContain("Unknown SKYLA_CONVEX_ENV_REQUIRE gate count: 1");
    expect(result.stderr).not.toContain("not-a-real-gate");
  });
});
