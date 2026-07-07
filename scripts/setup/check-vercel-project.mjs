import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const expected = {
  scope: "junyen-enterprises",
  projectRoot: "apps/web",
  projectName: "web",
  projectId: "prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr",
  orgId: "team_3kWPO8fPD6E7x39voGoNNeog",
  framework: "nextjs",
  nodeVersion: "24.x",
  vercelConfig: {
    framework: "nextjs",
    bunVersion: "1.x",
    installCommand: "cd ../.. && bash scripts/setup/vercel-install-bun-canary.sh",
    buildCommand: "cd ../.. && export PATH=\"$HOME/.bun/bin:$PATH\" && bun --revision && bun run web:build"
  }
};

const source = loadProjectInspect();
const repoConfig = loadRepoVercelConfig();
const localLink = loadLocalProjectLink();
const dashboard = normalizeProject(source.payload);

const checks = [
  check("dashboardProjectId", dashboard.id, expected.projectId, "Vercel project ID should stay linked to the Skyla web project."),
  check("dashboardProjectName", dashboard.name, expected.projectName, "Vercel project name should stay `web`."),
  check("dashboardRootDirectory", dashboard.rootDirectory, expected.projectRoot, "The Vercel project root must be the Next app at apps/web."),
  check("dashboardFramework", normalizeFramework(dashboard.framework), expected.framework, "The Vercel framework preset should be Next.js."),
  check("dashboardNodeVersion", dashboard.nodeVersion, expected.nodeVersion, "Vercel should build with Node 24.x."),
  check("repoFramework", repoConfig.data?.framework, expected.vercelConfig.framework, "apps/web/vercel.json should force the Next.js preset."),
  check("repoBunVersion", repoConfig.data?.bunVersion, expected.vercelConfig.bunVersion, "apps/web/vercel.json should request Vercel Bun 1.x."),
  check("repoInstallCommand", repoConfig.data?.installCommand, expected.vercelConfig.installCommand, "The repo install command should upgrade to Bun canary and run a frozen root install."),
  check("repoBuildCommand", repoConfig.data?.buildCommand, expected.vercelConfig.buildCommand, "The repo build command should build @skyla/web from the Turborepo root.")
];

if (localLink.present) {
  checks.push(
    check("localLinkProjectId", localLink.data?.projectId, expected.projectId, "Local apps/web/.vercel/project.json should point to the same Vercel project."),
    check("localLinkOrgId", localLink.data?.orgId, expected.orgId, "Local apps/web/.vercel/project.json should point to Junyen Enterprises."),
    check("localLinkProjectName", localLink.data?.projectName, expected.projectName, "Local apps/web/.vercel/project.json should name the web project.")
  );
} else if (process.env.SKYLA_VERCEL_REQUIRE_LOCAL_LINK === "1") {
  checks.push({
    name: "localLinkPresent",
    actual: null,
    expected: "apps/web/.vercel/project.json",
    ok: false,
    note: "Run `cd apps/web && bunx vercel link --yes --scope junyen-enterprises --project web` before dashboard work."
  });
}

if (repoConfig.error) {
  checks.push({
    name: "repoVercelConfigReadable",
    actual: repoConfig.error,
    expected: "readable apps/web/vercel.json",
    ok: false,
    note: "The committed Vercel config is required for Bun canary builds."
  });
}

const failedChecks = checks.filter((item) => !item.ok);
const output = {
  source: source.kind,
  scope: expected.scope,
  projectRoot: expected.projectRoot,
  readyForProjectShape: !source.error && failedChecks.length === 0,
  expected,
  dashboard,
  repoConfig: repoConfig.data,
  localLink: {
    present: localLink.present,
    data: localLink.data,
    note: localLink.present
      ? undefined
      : "Local .vercel links are gitignored; absence is expected in fresh clones but must be fixed before local dashboard commands."
  },
  checks,
  nextActions: buildNextActions({ source, failedChecks })
};

console.log(JSON.stringify(output, null, 2));

if (source.error) {
  console.error(source.error);
  process.exitCode = 1;
} else if (failedChecks.length > 0) {
  console.error("One or more Vercel project readiness checks failed. See JSON output.");
  process.exitCode = 1;
}

function loadProjectInspect() {
  if (process.env.SKYLA_VERCEL_PROJECT_JSON) {
    return {
      kind: "env",
      payload: parseJson(process.env.SKYLA_VERCEL_PROJECT_JSON, "SKYLA_VERCEL_PROJECT_JSON")
    };
  }

  if (process.env.SKYLA_VERCEL_PROJECT_INSPECT_TEXT) {
    return {
      kind: "env-text",
      payload: parseProjectInspectText(process.env.SKYLA_VERCEL_PROJECT_INSPECT_TEXT)
    };
  }

  const cwd = resolve(process.env.SKYLA_VERCEL_PROJECT_ROOT || expected.projectRoot);
  if (!existsSync(cwd)) {
    return {
      kind: "vercel-cli",
      payload: {},
      error: `Vercel project root does not exist: ${cwd}`
    };
  }

  const cli = process.env.SKYLA_VERCEL_CLI || "bunx";
  const args = process.env.SKYLA_VERCEL_CLI
    ? ["project", "inspect", expected.projectName, "--scope", expected.scope]
    : ["vercel", "project", "inspect", expected.projectName, "--scope", expected.scope];
  const result = spawnSync(cli, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return {
      kind: "vercel-cli",
      payload: {},
      error: [
        "Could not inspect Vercel project settings.",
        "Run `cd apps/web && bunx vercel link --yes --scope junyen-enterprises --project web`, then retry.",
        result.stderr.trim() || result.stdout.trim()
      ].filter(Boolean).join(" ")
    };
  }

  return {
    kind: "vercel-cli",
    payload: parseProjectInspectText([result.stdout, result.stderr].filter(Boolean).join("\n"))
  };
}

function loadRepoVercelConfig() {
  const path = resolve(expected.projectRoot, "vercel.json");
  try {
    return {
      data: parseJson(readFileSync(path, "utf8"), path)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      data: null,
      error: message
    };
  }
}

function loadLocalProjectLink() {
  const path = resolve(expected.projectRoot, ".vercel/project.json");
  if (!existsSync(path)) {
    return {
      present: false,
      data: null
    };
  }

  return {
    present: true,
    data: parseJson(readFileSync(path, "utf8"), path)
  };
}

function normalizeProject(payload) {
  return {
    id: stringValue(payload.id ?? payload.projectId),
    name: stringValue(payload.name ?? payload.projectName),
    rootDirectory: stringValue(payload.rootDirectory ?? payload.rootDirectoryName ?? payload.root),
    framework: stringValue(payload.framework ?? payload.frameworkPreset),
    nodeVersion: stringValue(payload.nodeVersion),
    buildCommand: stringValue(payload.buildCommand),
    installCommand: stringValue(payload.installCommand)
  };
}

function parseProjectInspectText(value) {
  const fields = {};
  const labels = new Map([
    ["ID", "id"],
    ["Name", "name"],
    ["Root Directory", "rootDirectory"],
    ["Node.js Version", "nodeVersion"],
    ["Framework Preset", "framework"],
    ["Build Command", "buildCommand"],
    ["Install Command", "installCommand"]
  ]);

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, "").replace(/\u0008/g, "").trim();
    for (const [label, key] of labels) {
      if (line.startsWith(label)) {
        fields[key] = cleanCliValue(line.slice(label.length));
      }
    }
  }

  return fields;
}

function cleanCliValue(value) {
  const trimmed = value.trim();
  const inner = trimmed.slice(1, -1);
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && !inner.includes("`")) {
    return inner;
  }
  return trimmed;
}

function check(name, actual, expectedValue, note) {
  return {
    name,
    actual: actual ?? null,
    expected: expectedValue,
    ok: actual === expectedValue,
    note
  };
}

function normalizeFramework(value) {
  const normalized = stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "nextjs") {
    return "nextjs";
  }
  return normalized;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Could not parse ${label}: ${message}`);
  }
}

function buildNextActions({ source, failedChecks }) {
  const actions = [];

  if (source.error) {
    actions.push({
      id: "link-vercel-project",
      owner: "operator",
      priority: 1,
      action: "Link the local apps/web directory to the Junyen Enterprises web project, then rerun the project checker.",
      command: "cd apps/web && bunx vercel link --yes --scope junyen-enterprises --project web"
    });
  }

  if (failedChecks.length > 0) {
    actions.push({
      id: "fix-vercel-project-shape",
      owner: "vercel-dashboard-and-repo",
      priority: 2,
      action: "Keep the Vercel dashboard project on apps/web, Next.js, Node 24.x, and keep apps/web/vercel.json as the Bun canary build authority.",
      command: "bun run vercel:project:check",
      failing: failedChecks.map((item) => item.name)
    });
  }

  return actions;
}
