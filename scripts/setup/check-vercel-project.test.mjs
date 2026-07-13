import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/setup/check-vercel-project.mjs");
const goodProject = {
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
      SKYLA_VERCEL_PROJECT_JSON: JSON.stringify(goodProject),
      ...extraEnv
    },
    encoding: "utf8"
  });
}

function runCheckWithFakeCli(stdout, stream = "stdout") {
  const dir = mkdtempSync(resolve(tmpdir(), "skyla-vercel-project-"));
  const cliPath = resolve(dir, "vercel-fixture");
  writeFileSync(cliPath, `#!/usr/bin/env node\nprocess.${stream}.write(${JSON.stringify(stdout)});\n`, "utf8");
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

describe("check-vercel-project", () => {
  it("passes when the dashboard shape and repo Vercel config match Skyla", () => {
    const result = runCheck();

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.readyForProjectShape).toBe(true);
    expect(output.dashboard).toMatchObject({
      id: goodProject.id,
      name: "web",
      rootDirectory: "apps/web",
      framework: "nextjs",
      nodeVersion: "24.x"
    });
    expect(output.repoConfig).toMatchObject({
      framework: "nextjs",
      bunVersion: "1.x",
      installCommand: "cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh"
    });
    expect(output.rootPackage.packageManager).toBe("bun@1.4.0-canary.1");
    expect(output.rootPackage.engines.bun).toBe("1.4.0-canary.1");
    expect(output.bunInstaller).toMatchObject({
      immutable: true,
      pins: {
        version: "1.4.0-canary.1",
        mirrorRelease: "toolchain-bun-1.4.0-canary.1-8f1a9540f",
        downloadUrlTemplate: "https://github.com/junyengit/skyla/releases/download/$BUN_MIRROR_RELEASE/$BUN_ASSET.zip",
        linuxX64Revision: "1.4.0-canary.1+8f1a9540f",
        linuxX64Sha256: "21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711"
      }
    });
  });

  it("rejects a mutable Bun canary installer", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "skyla-bun-installer-"));
    const installerPath = resolve(dir, "install.sh");
    writeFileSync(
      installerPath,
      '#!/usr/bin/env bash\ncurl -fsSL https://bun.com/install | bash\nbun upgrade --canary\n',
      "utf8"
    );

    try {
      const result = runCheck({
        SKYLA_VERCEL_BUN_INSTALLER_PATH: installerPath
      });

      expect(result.status).toBe(1);
      const output = parseStdout(result);
      expect(output.readyForProjectShape).toBe(false);
      expect(output.bunInstaller.immutable).toBe(false);
      expect(output.nextActions[0].failing).toEqual(
        expect.arrayContaining([
          "repoBunCanaryVersionPin",
          "repoBunMirrorReleasePin",
          "repoBunDownloadUrlTemplate",
          "repoBunLinuxX64RevisionPin",
          "repoBunLinuxX64ChecksumPin",
          "repoBunInstallerImmutable"
        ])
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects Bun's moving canary release URL even when version pins exist", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "skyla-bun-installer-"));
    const installerPath = resolve(dir, "install.sh");
    writeFileSync(
      installerPath,
      [
        '#!/usr/bin/env bash',
        'BUN_CANARY_VERSION="1.4.0-canary.1"',
        'BUN_MIRROR_RELEASE="toolchain-bun-1.4.0-canary.1-8f1a9540f"',
        'BUN_LINUX_X64_REVISION="1.4.0-canary.1+8f1a9540f"',
        'BUN_LINUX_X64_SHA256="21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711"',
        'curl --fail --location "https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip" --output bun.zip'
      ].join("\n"),
      "utf8"
    );

    try {
      const result = runCheck({
        SKYLA_VERCEL_BUN_INSTALLER_PATH: installerPath
      });

      expect(result.status).toBe(1);
      const output = parseStdout(result);
      expect(output.bunInstaller.immutable).toBe(false);
      expect(output.nextActions[0].failing).toContain("repoBunInstallerImmutable");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("rejects an installer that declares but does not use the reviewed mirror", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "skyla-bun-installer-"));
    const installerPath = resolve(dir, "install.sh");
    writeFileSync(
      installerPath,
      [
        '#!/usr/bin/env bash',
        'BUN_CANARY_VERSION="1.4.0-canary.1"',
        'BUN_MIRROR_RELEASE="toolchain-bun-1.4.0-canary.1-8f1a9540f"',
        'BUN_LINUX_X64_REVISION="1.4.0-canary.1+8f1a9540f"',
        'BUN_LINUX_X64_SHA256="21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711"',
        'DOWNLOAD_URL="https://downloads.example.com/$BUN_ASSET.zip"',
        'curl --fail --location "$DOWNLOAD_URL" --output bun.zip'
      ].join("\n"),
      "utf8"
    );

    try {
      const result = runCheck({
        SKYLA_VERCEL_BUN_INSTALLER_PATH: installerPath
      });

      expect(result.status).toBe(1);
      const output = parseStdout(result);
      expect(output.bunInstaller.immutable).toBe(false);
      expect(output.nextActions[0].failing).toEqual(
        expect.arrayContaining(["repoBunDownloadUrlTemplate", "repoBunInstallerImmutable"])
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("flags dashboard drift before env or payment setup continues", () => {
    const result = runCheck({
      SKYLA_VERCEL_PROJECT_JSON: JSON.stringify({
        ...goodProject,
        rootDirectory: ".",
        nodeVersion: "26.x"
      })
    });

    expect(result.status).toBe(1);
    const output = parseStdout(result);
    expect(output.readyForProjectShape).toBe(false);
    expect(output.nextActions).toEqual([
      expect.objectContaining({
        id: "fix-vercel-project-shape",
        failing: expect.arrayContaining(["dashboardRootDirectory", "dashboardNodeVersion"])
      })
    ]);
    expect(result.stderr).toContain("One or more Vercel project readiness checks failed");
  });

  it("parses Vercel CLI project inspect output", () => {
    const result = runCheckWithFakeCli(`
Vercel CLI 54.21.1 (Node.js 26.4.0)
> Found Project junyen-enterprises/web [249ms]

  General

    ID                              prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr
    Name                            web
    Owner                           Junyen Enterprises
    Root Directory                  apps/web
    Node.js Version                 24.x

  Framework Settings

    Framework Preset                Next.js
    Build Command                   \`npm run build\` or \`next build\`
    Output Directory                Next.js default
    Install Command                 \`yarn install\`, \`pnpm install\`, \`npm install\`, or \`bun install\`
`);

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.source).toBe("vercel-cli");
    expect(output.readyForProjectShape).toBe(true);
    expect(output.dashboard.framework).toBe("Next.js");
    expect(output.dashboard.buildCommand).toContain("npm run build");
  });

  it("parses Vercel CLI project inspect output when the CLI writes to stderr", () => {
    const result = runCheckWithFakeCli(`
Vercel CLI 54.21.1 (Node.js 26.4.0)
> Found Project junyen-enterprises/web [249ms]

    ID				prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr
    Name			web
    Root Directory		apps/web
    Node.js Version		24.x
    Framework Preset		Next.js
`, "stderr");

    expect(result.status).toBe(0);
    const output = parseStdout(result);
    expect(output.readyForProjectShape).toBe(true);
    expect(output.dashboard.id).toBe(goodProject.id);
  });
});
