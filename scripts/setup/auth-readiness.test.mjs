import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function run(script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  return {
    status: result.status,
    output: JSON.parse(result.stdout)
  };
}

describe("staff auth dashboard readiness", () => {
  it("requires Clerk keys in both Vercel Preview and Production", () => {
    const ready = run("scripts/setup/check-vercel-env.mjs", {
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({
        envs: [
          { key: "NEXT_PUBLIC_CONVEX_URL", target: ["preview"] },
          { key: "NEXT_PUBLIC_CONVEX_URL", target: ["production"] },
          { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["preview"] },
          { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["production"] },
          { key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", target: ["preview", "production"] },
          { key: "CLERK_SECRET_KEY", target: ["preview", "production"] },
          { key: "SKYLA_PUBLIC_ORIGIN", target: ["preview"] },
          { key: "SKYLA_PUBLIC_ORIGIN", target: ["production"] }
        ]
      })
    });
    expect(ready.status).toBe(0);
    expect(ready.output).toMatchObject({ readyForConvexUrl: true, readyForStaffAuth: true });

    const incomplete = run("scripts/setup/check-vercel-env.mjs", {
      SKYLA_VERCEL_ENV_JSON: JSON.stringify({
        envs: [
          { key: "NEXT_PUBLIC_CONVEX_URL", target: ["preview"] },
          { key: "NEXT_PUBLIC_CONVEX_URL", target: ["production"] },
          { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["preview"] },
          { key: "SKYLA_PUBLIC_GATEWAY_SECRET", target: ["production"] },
          { key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", target: ["preview"] },
          { key: "CLERK_SECRET_KEY", target: ["preview", "production"] },
          { key: "SKYLA_PUBLIC_ORIGIN", target: ["preview"] },
          { key: "SKYLA_PUBLIC_ORIGIN", target: ["production"] }
        ]
      })
    });
    expect(incomplete.status).toBe(1);
    expect(incomplete.output.readyForStaffAuth).toBe(false);
  });

  it("requires the Clerk Convex integration issuer domain", () => {
    const baseEnv = {
      CONVEX_DEPLOYMENT: "dev:skyla",
      NEXT_PUBLIC_CONVEX_URL: "https://skyla.convex.cloud",
      SKYLA_CONVEX_ENV_REQUIRE: "staff-auth"
    };
    const ready = run("scripts/setup/check-convex-env.mjs", {
      ...baseEnv,
      CLERK_JWT_ISSUER_DOMAIN: "https://skyla-staff.clerk.accounts.dev"
    });
    expect(ready.status).toBe(0);
    expect(ready.output.readyForStaffAuth).toBe(true);

    const invalid = run("scripts/setup/check-convex-env.mjs", {
      ...baseEnv,
      CLERK_JWT_ISSUER_DOMAIN: "https://example.com"
    });
    expect(invalid.status).toBe(1);
    expect(invalid.output.readyForStaffAuth).toBe(false);
  });
});
