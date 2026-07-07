import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-dashboard-readiness.mjs");
const stripeSecretKeyName = ["STRIPE", "SECRET_KEY"].join("_");
const stripeSecretKeyValue = ["sk", "test", "thisShouldNeverAppearInOutput"].join("_");
const stripeWebhookSecretValue = ["whsec", "thisShouldNeverAppearInOutput"].join("_");
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
      SKYLA_STAFF_BOOTSTRAP_TOKEN: ""
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.status).toBe("dashboard_setup_required");
    expect(output.safeToUseRealCards).toBe(false);
    expect(output.readyForNoWritePreflight).toBe(false);
    expect(output.gates).toMatchObject({
      vercelProjectShape: true,
      vercelConvexUrl: false,
      safeVercelSecretPlacement: true,
      convexCloudPersistence: false,
      stripeCheckout: false,
      stripeWebhook: false,
      terminalReaderHandoff: false
    });
    expect(output.nextActions.map((action) => action.id)).toEqual([
      "add-vercel-convex-url",
      "link-convex-cloud",
      "configure-stripe-checkout-env",
      "configure-stripe-webhook",
      "seed-staff",
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
            target: ["preview", "production"]
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
      SKYLA_STAFF_BOOTSTRAP_TOKEN: "0123456789abcdef0123456789abcdef"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(stripeSecretKeyValue);
    expect(result.stdout).not.toContain(stripeWebhookSecretValue);
    const output = parseStdout(result);
    expect(output.status).toBe("linked_preflight_ready");
    expect(output.readyForNoWritePreflight).toBe(true);
    expect(output.readyForTerminalAcceptance).toBe(true);
    expect(output.nextActions.map((action) => action.id)).toEqual([
      "run-linked-acceptance",
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
