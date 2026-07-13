import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-vercel-env.mjs");
const stripeSecretKeyName = ["STRIPE", "SECRET_KEY"].join("_");
const readyStaffAuthEnvs = [
  { key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", target: ["preview", "production"] },
  { key: "CLERK_SECRET_KEY", target: ["preview", "production"] }
];
const readyPublicOriginEnvs = [
  { key: "SKYLA_PUBLIC_ORIGIN", target: ["preview"] },
  { key: "SKYLA_PUBLIC_ORIGIN", target: ["production"] }
];
const readyPublicGatewayEnvs = [
  { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["preview"] },
  { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["production"] }
];

function runCheck(payload, extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET: "",
      ...extraEnv,
      SKYLA_VERCEL_ENV_JSON: JSON.stringify(payload)
    },
    encoding: "utf8"
  });
}

function runCheckWithFakeCli(stdout) {
  const dir = mkdtempSync(resolve(tmpdir(), "skyla-vercel-env-"));
  const cliPath = resolve(dir, "vercel-fixture");
  writeFileSync(cliPath, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`, "utf8");
  chmodSync(cliPath, 0o700);

  try {
    return spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET: "",
        SKYLA_VERCEL_CLI: cliPath,
        SKYLA_VERCEL_PROJECT_ROOT: "."
      },
      encoding: "utf8"
    });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function parseStdout(result) {
  return JSON.parse(result.stdout);
}

describe("check-vercel-env", () => {
  it("fails closed when the Vercel project has no environment variables", () => {
    const result = runCheck({ envs: [] });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.readyForConvexUrl).toBe(false);
    expect(output.envCount).toBe(0);
    expect(output.checks).toEqual([
      {
        key: "NEXT_PUBLIC_CONVEX_URL",
        requiredTargets: ["preview"],
        disallowedTargets: ["production"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "Vercel Preview must use the Convex development URL, separate from Production"
      },
      {
        key: "NEXT_PUBLIC_CONVEX_URL",
        requiredTargets: ["production"],
        disallowedTargets: ["preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "Vercel Production must use the Convex production URL, separate from Preview"
      },
      {
        key: "SKYLA_PUBLIC_GATEWAY_SECRET",
        requiredTargets: ["preview"],
        disallowedTargets: ["production"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "server-only Preview gateway secret paired with the Convex development deployment"
      },
      {
        key: "SKYLA_PUBLIC_GATEWAY_SECRET",
        requiredTargets: ["production"],
        disallowedTargets: ["preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "server-only Production gateway secret paired with the Convex production deployment"
      },
      {
        key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        requiredTargets: ["production", "preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "browser-safe Clerk key required by the staff sign-in provider"
      },
      {
        key: "CLERK_SECRET_KEY",
        requiredTargets: ["production", "preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "server-only Clerk key required by the Next.js staff auth proxy"
      },
      {
        key: "SKYLA_PUBLIC_ORIGIN",
        requiredTargets: ["preview"],
        disallowedTargets: ["production"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "Vercel Preview must use its explicit Preview HTTPS origin for ticket QR links"
      },
      {
        key: "SKYLA_PUBLIC_ORIGIN",
        requiredTargets: ["production"],
        disallowedTargets: ["preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "Vercel Production must use the canonical production HTTPS origin for ticket QR links"
      }
    ]);
    expect(result.stderr).toContain("One or more Vercel env readiness checks failed");
  });

  it("passes when separate Convex URLs and Clerk keys cover Preview and Production", () => {
    const result = runCheck({
      envs: [
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["preview"]
        },
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["production"]
        },
        ...readyStaffAuthEnvs,
        ...readyPublicOriginEnvs,
        ...readyPublicGatewayEnvs,
        {
          key: "NEXT_PUBLIC_GOOGLE_ADS_TAG_ID",
          target: "production"
        }
      ]
    });

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.readyForConvexUrl).toBe(true);
    expect(output.readyForPublicGateway).toBe(true);
    expect(output.readyForStaffAuth).toBe(true);
    expect(output.safeSecretPlacement).toBe(true);
    expect(output.readyForTerminalAcceptance).toBe(false);
    expect(output.checks[0].presentTargets).toEqual(["preview", "production"]);
  });

  it("rejects one Convex URL binding shared by Preview and Production", () => {
    const result = runCheck({
      envs: [
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["preview", "production"]
        },
        ...readyStaffAuthEnvs,
        ...readyPublicOriginEnvs,
        ...readyPublicGatewayEnvs
      ]
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.readyForConvexUrl).toBe(false);
    expect(output.checks.slice(0, 2).every((check) => check.present)).toBe(true);
    expect(output.checks.slice(0, 2).every((check) => !check.ok)).toBe(true);
  });

  it("parses Vercel CLI banner text before array-shaped JSON", () => {
    const result = runCheckWithFakeCli(`Vercel CLI 50.28.0\n${JSON.stringify([
      {
        key: "NEXT_PUBLIC_CONVEX_URL",
        target: ["preview"]
      },
      {
        key: "NEXT_PUBLIC_CONVEX_URL",
        target: ["production"]
      },
      ...readyStaffAuthEnvs,
      ...readyPublicOriginEnvs,
      ...readyPublicGatewayEnvs
    ])}`);

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.source).toBe("vercel-cli");
    expect(output.readyForConvexUrl).toBe(true);
    expect(output.envCount).toBe(8);
  });

  it("requires and allows the Terminal latch only for an acknowledged acceptance target", () => {
    const envs = [
      { key: "NEXT_PUBLIC_CONVEX_URL", target: ["preview"] },
      { key: "NEXT_PUBLIC_CONVEX_URL", target: ["production"] },
      ...readyStaffAuthEnvs,
      ...readyPublicOriginEnvs,
      ...readyPublicGatewayEnvs,
      { key: "SKYLA_POS_TERMINAL_ACCEPTANCE", target: ["preview"] }
    ];

    const unacknowledged = runCheck({ envs });
    expect(unacknowledged.status).toBe(1);
    expect(parseStdout(unacknowledged).terminalAcceptance).toMatchObject({
      required: false,
      activeTargets: ["preview"],
      ok: false
    });

    const acknowledged = runCheck(
      { envs },
      { SKYLA_VERCEL_TERMINAL_ACCEPTANCE_TARGET: "preview" }
    );
    expect(acknowledged.status).toBe(0);
    expect(parseStdout(acknowledged)).toMatchObject({
      readyForTerminalAcceptance: true,
      terminalAcceptance: {
        required: true,
        requestedTarget: "preview",
        activeTargets: ["preview"],
        ok: true
      }
    });
  });

  it("flags Stripe, ticket-email, reader registry, and staff values if they are added to Vercel", () => {
    const result = runCheck({
      envs: [
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["preview"]
        },
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["production"]
        },
        ...readyStaffAuthEnvs,
        ...readyPublicOriginEnvs,
        ...readyPublicGatewayEnvs,
        {
          key: stripeSecretKeyName,
          target: ["production"]
        },
        {
          key: "SKYLA_STAFF_BOOTSTRAP_TOKEN",
          targets: ["preview"]
        },
        {
          key: "SKYLA_TERMINAL_READER_REGISTRY",
          targets: ["preview"]
        },
        {
          key: "RESEND_API_KEY",
          targets: ["production"]
        },
        {
          key: "NEXT_PUBLIC_WEBHOOK_SECRET",
          environment: "production"
        }
      ]
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.readyForConvexUrl).toBe(true);
    expect(output.safeSecretPlacement).toBe(false);
    expect(output.forbidden).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: stripeSecretKeyName,
          present: true,
          presentTargets: ["production"],
          ok: false
        }),
        expect.objectContaining({
          key: "SKYLA_STAFF_BOOTSTRAP_TOKEN",
          present: true,
          presentTargets: ["preview"],
          ok: false
        }),
        expect.objectContaining({
          key: "SKYLA_TERMINAL_READER_REGISTRY",
          present: true,
          presentTargets: ["preview"],
          ok: false
        }),
        expect.objectContaining({
          key: "RESEND_API_KEY",
          present: true,
          presentTargets: ["production"],
          ok: false
        })
      ])
    );
    expect(output.publicSecretLike).toEqual([
      expect.objectContaining({
        key: "NEXT_PUBLIC_WEBHOOK_SECRET",
        presentTargets: ["production"],
        ok: false
      })
    ]);
  });
});
