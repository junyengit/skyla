import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-dashboard-readiness.mjs");
const stripeSecretKeyName = ["STRIPE", "SECRET_KEY"].join("_");
const stripeSecretKeyValue = ["sk", "test", "thisShouldNeverAppearInOutput"].join("_");
const stripeWebhookSecretValue = ["whsec", "thisShouldNeverAppearInOutput"].join("_");
const publicGatewaySecretValue = "gatewaySecretThatShouldNeverAppear123";
const goodVercelProject = {
  id: "prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr",
  name: "web",
  rootDirectory: "apps/web",
  framework: "nextjs",
  nodeVersion: "24.x"
};

function runCheck(extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SKYLA_VERCEL_PROJECT_JSON: JSON.stringify(goodVercelProject),
      ...extraEnv
    },
    encoding: "utf8"
  });
}

function parseStdout(result) {
  return JSON.parse(result.stdout);
}

describe("check-dashboard-readiness", () => {
  it("fails closed with ordered dashboard actions when no Vercel or Convex envs are ready", () => {
    const result = runCheck({
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({ envs: [] }),
      CONVEX_DEPLOYMENT: "",
      NEXT_PUBLIC_CONVEX_URL: "",
      CONVEX_URL: "",
      SKYLA_STRIPE_MODE: "",
      [stripeSecretKeyName]: "",
      SKYLA_PAYMENT_RETURN_ORIGINS: "",
      STRIPE_WEBHOOK_SECRET: "",
      SKYLA_TERMINAL_READER_REGISTRY: "",
      SKYLA_POS_TERMINAL_ACCEPTANCE: "",
      SKYLA_STAFF_BOOTSTRAP_TOKEN: "",
      CLERK_JWT_ISSUER_DOMAIN: "",
      RESEND_API_KEY: "",
      SKYLA_TICKET_FROM_EMAIL: "",
      SKYLA_TICKET_REPLY_TO: "",
      SKYLA_PUBLIC_ORIGIN: "",
      SKYLA_PUBLIC_GATEWAY_SECRET: ""
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.status).toBe("dashboard_setup_required");
    expect(output.safeToUseRealCards).toBe(false);
    expect(output.realCardPolicy).toContain("explicit live cutover approval");
    expect(output.readyForNoWritePreflight).toBe(false);
    expect(output.gates).toMatchObject({
      vercelProjectShape: true,
      vercelConvexUrl: false,
      publicGateway: false,
      staffAuth: false,
      safeVercelSecretPlacement: true,
      convexCloudPersistence: false,
      stripeCheckout: false,
      stripeWebhook: false,
      ticketEmail: false,
      terminalReaderHandoff: false
    });
    expect(output.nextActions.map((action) => action.id)).toEqual([
      "add-vercel-convex-url",
      "configure-public-gateway",
      "configure-staff-auth",
      "link-convex-cloud",
      "configure-stripe-checkout-env",
      "configure-stripe-webhook",
      "configure-ticket-email",
      "configure-terminal-reader"
    ]);
    expect(result.stderr).toContain("Dashboard readiness is not complete");
  });

  it("passes when Vercel and Convex test-mode dashboard gates are shaped correctly", () => {
    const result = runCheck({
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({
        envs: [
          {
            key: "NEXT_PUBLIC_CONVEX_URL",
            target: ["preview"]
          },
          {
            key: "NEXT_PUBLIC_CONVEX_URL",
            target: ["production"]
          },
          {
            key: "SKYLA_PUBLIC_GATEWAY_SECRET",
            target: ["preview"]
          },
          {
            key: "SKYLA_PUBLIC_GATEWAY_SECRET",
            target: ["production"]
          },
          {
            key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
            target: ["preview", "production"]
          },
          {
            key: "CLERK_SECRET_KEY",
            target: ["preview", "production"]
          },
          {
            key: "SKYLA_PUBLIC_ORIGIN",
            target: ["preview"]
          },
          {
            key: "SKYLA_PUBLIC_ORIGIN",
            target: ["production"]
          }
        ]
      }),
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_STRIPE_MODE: "test",
      [stripeSecretKeyName]: stripeSecretKeyValue,
      SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com,https://www.skydeckla.com",
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecretValue,
      SKYLA_TERMINAL_READER_REGISTRY: "tmr_frontdesk@tml_lobby",
      SKYLA_POS_TERMINAL_ACCEPTANCE: "enabled",
      SKYLA_STAFF_BOOTSTRAP_TOKEN: "0123456789abcdef0123456789abcdef",
      CLERK_JWT_ISSUER_DOMAIN: "https://clerk.skydeckla.com",
      RESEND_API_KEY: "re_test_placeholder",
      SKYLA_TICKET_FROM_EMAIL: "Sky LA <tickets@skydeckla.com>",
      SKYLA_TICKET_REPLY_TO: "reservations@skydeckla.com",
      SKYLA_PUBLIC_ORIGIN: "https://skydeckla.com",
      SKYLA_PUBLIC_GATEWAY_SECRET: publicGatewaySecretValue
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(stripeSecretKeyValue);
    expect(result.stdout).not.toContain(stripeWebhookSecretValue);
    expect(result.stdout).not.toContain(publicGatewaySecretValue);
    const output = parseStdout(result);
    expect(output.status).toBe("linked_preflight_ready");
    expect(output.safeToUseRealCards).toBe(false);
    expect(output.realCardPolicy).toContain("explicit live cutover approval");
    expect(output.readyForNoWritePreflight).toBe(true);
    expect(output.readyForTerminalAcceptance).toBe(true);
    expect(output.nextActions.map((action) => action.id)).toEqual([
      "run-linked-acceptance",
      "seed-staff",
      "run-linked-write-acceptance"
    ]);
  });

  it("places Vercel project-shape drift before env setup actions", () => {
    const result = runCheck({
      SKYLA_VERCEL_PROJECT_JSON: JSON.stringify({
        ...goodVercelProject,
        rootDirectory: ".",
        nodeVersion: "26.x"
      }),
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({ envs: [] }),
      CONVEX_DEPLOYMENT: "",
      NEXT_PUBLIC_CONVEX_URL: "",
      CONVEX_URL: ""
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.gates.vercelProjectShape).toBe(false);
    expect(output.nextActions[0]).toMatchObject({
      id: "fix-vercel-project-shape",
      evidence: expect.arrayContaining(["dashboardRootDirectory", "dashboardNodeVersion"])
    });
  });

  it("prioritizes removing misplaced Vercel secrets before adding more dashboard envs", () => {
    const result = runCheck({
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({
        envs: [
          {
            key: "NEXT_PUBLIC_CONVEX_URL",
            target: ["preview", "production"]
          },
          {
            key: stripeSecretKeyName,
            target: ["production"]
          }
        ]
      }),
      CONVEX_DEPLOYMENT: "prod:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_STRIPE_MODE: "test",
      [stripeSecretKeyName]: "sk_test_placeholder",
      SKYLA_PAYMENT_RETURN_ORIGINS: "https://skydeckla.com",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder"
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.gates.safeVercelSecretPlacement).toBe(false);
    expect(output.nextActions[0]).toMatchObject({
      id: "clean-vercel-secrets",
      owner: "vercel-dashboard",
      evidence: [stripeSecretKeyName]
    });
  });
});
