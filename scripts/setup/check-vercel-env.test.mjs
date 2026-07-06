import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-vercel-env.mjs");
const stripeSecretKeyName = ["STRIPE", "SECRET_KEY"].join("_");

function runCheck(payload) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
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
        requiredTargets: ["production", "preview"],
        present: false,
        presentTargets: [],
        ok: false,
        note: "required by Vercel-hosted Next routes before Convex-backed writes can persist"
      }
    ]);
    expect(result.stderr).toContain("One or more Vercel env readiness checks failed");
  });

  it("passes when NEXT_PUBLIC_CONVEX_URL is present for Preview and Production only", () => {
    const result = runCheck({
      envs: [
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["preview", "production"]
        },
        {
          key: "NEXT_PUBLIC_GOOGLE_ADS_TAG_ID",
          target: "production"
        }
      ]
    });

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.readyForConvexUrl).toBe(true);
    expect(output.safeSecretPlacement).toBe(true);
    expect(output.checks[0].presentTargets).toEqual(["preview", "production"]);
  });

  it("parses Vercel CLI banner text before array-shaped JSON", () => {
    const result = runCheckWithFakeCli(`Vercel CLI 50.28.0\n${JSON.stringify([
      {
        key: "NEXT_PUBLIC_CONVEX_URL",
        target: ["preview", "production"]
      }
    ])}`);

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.source).toBe("vercel-cli");
    expect(output.readyForConvexUrl).toBe(true);
    expect(output.envCount).toBe(1);
  });

  it("flags Stripe and staff secrets if they are accidentally added to Vercel", () => {
    const result = runCheck({
      envs: [
        {
          key: "NEXT_PUBLIC_CONVEX_URL",
          target: ["production", "preview"]
        },
        {
          key: stripeSecretKeyName,
          target: ["production"]
        },
        {
          key: "SKYLA_STAFF_BOOTSTRAP_TOKEN",
          targets: ["preview"]
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
