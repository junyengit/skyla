import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultScope = "junyen-enterprises";
const required = [
  {
    key: "NEXT_PUBLIC_CONVEX_URL",
    targets: ["production", "preview"],
    note: "required by Vercel-hosted Next routes before Convex-backed writes can persist"
  },
  {
    key: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    targets: ["production", "preview"],
    note: "browser-safe Clerk key required by the staff sign-in provider"
  },
  {
    key: "CLERK_SECRET_KEY",
    targets: ["production", "preview"],
    note: "server-only Clerk key required by the Next.js staff auth proxy"
  }
];
const forbiddenKeys = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SKYLA_STAFF_BOOTSTRAP_TOKEN",
  "SKYLA_TERMINAL_READER_REGISTRY",
  "SKYLA_POS_TERMINAL_ACCEPTANCE"
];

const source = loadEnvList();
const envs = normalizeEnvList(source.payload);
const checks = required.map((item) => {
  const matches = envs.filter((entry) => entry.key === item.key);
  const presentTargets = sortedTargets(matches.flatMap((entry) => entry.targets));
  return {
    key: item.key,
    requiredTargets: item.targets,
    present: matches.length > 0,
    presentTargets,
    ok: item.targets.every((target) => presentTargets.includes(target)),
    note: item.note
  };
});
const forbidden = forbiddenKeys.map((key) => {
  const matches = envs.filter((entry) => entry.key === key);
  const presentTargets = sortedTargets(matches.flatMap((entry) => entry.targets));
  return {
    key,
    present: matches.length > 0,
    presentTargets,
    ok: matches.length === 0,
    note: matches.length > 0 ? "belongs in Convex or another secret manager, not the Vercel project env list" : undefined
  };
});
const publicSecretLike = envs
  .filter((entry) => entry.key.startsWith("NEXT_PUBLIC_") && /(SECRET|TOKEN|PRIVATE|WEBHOOK)$/i.test(entry.key))
  .map((entry) => ({
    key: entry.key,
    presentTargets: sortedTargets(entry.targets),
    ok: false,
    note: "NEXT_PUBLIC_* values are browser-readable; do not expose secret-like names"
  }));

const output = {
  source: source.kind,
  scope: source.scope,
  projectRoot: source.projectRoot,
  readyForConvexUrl: checks.find((check) => check.key === "NEXT_PUBLIC_CONVEX_URL")?.ok ?? false,
  readyForStaffAuth: checks
    .filter((check) => check.key === "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" || check.key === "CLERK_SECRET_KEY")
    .every((check) => check.ok),
  safeSecretPlacement: forbidden.every((check) => check.ok) && publicSecretLike.length === 0,
  checks,
  forbidden,
  publicSecretLike,
  envCount: envs.length
};

console.log(JSON.stringify(output, null, 2));

const failedRequired = checks.filter((check) => !check.ok);
const misplacedSecrets = forbidden.filter((check) => !check.ok).length + publicSecretLike.length;

if (source.error) {
  console.error(source.error);
  process.exitCode = 1;
} else if (failedRequired.length > 0 || misplacedSecrets > 0) {
  console.error("One or more Vercel env readiness checks failed. See JSON output.");
  process.exitCode = 1;
}

function loadEnvList() {
  const scope = process.env.SKYLA_VERCEL_SCOPE || defaultScope;
  const projectRoot = process.env.SKYLA_VERCEL_PROJECT_ROOT || "apps/web";

  if (process.env.SKYLA_VERCEL_ENV_JSON) {
    return {
      kind: "env",
      scope,
      projectRoot,
      payload: parseJson(process.env.SKYLA_VERCEL_ENV_JSON, "SKYLA_VERCEL_ENV_JSON")
    };
  }

  if (process.env.SKYLA_VERCEL_ENV_FILE) {
    const path = resolve(process.env.SKYLA_VERCEL_ENV_FILE);
    return {
      kind: "file",
      scope,
      projectRoot,
      payload: parseJson(readFileSync(path, "utf8"), path)
    };
  }

  const cwd = resolve(projectRoot);
  if (!existsSync(cwd)) {
    return {
      kind: "vercel-cli",
      scope,
      projectRoot,
      payload: { envs: [] },
      error: `Vercel project root does not exist: ${cwd}`
    };
  }

  const cli = process.env.SKYLA_VERCEL_CLI || "bunx";
  const args = process.env.SKYLA_VERCEL_CLI
    ? ["env", "ls", "--format", "json", "--scope", scope]
    : ["vercel", "env", "ls", "--format", "json", "--scope", scope];
  const result = spawnSync(cli, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return {
      kind: "vercel-cli",
      scope,
      projectRoot,
      payload: { envs: [] },
      error: [
        "Could not read Vercel env list.",
        "Run `cd apps/web && bunx vercel link --yes --scope junyen-enterprises --project web`, then retry.",
        result.stderr.trim() || result.stdout.trim()
      ].filter(Boolean).join(" ")
    };
  }

  return {
    kind: "vercel-cli",
    scope,
    projectRoot,
    payload: parseJson(stripVercelBanner(result.stdout), "vercel env ls --format json")
  };
}

function normalizeEnvList(payload) {
  const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.envs) ? payload.envs : [];
  return entries
    .map((entry) => ({
      key: typeof entry?.key === "string" ? entry.key : "",
      targets: normalizeTargets(entry)
    }))
    .filter((entry) => entry.key);
}

function normalizeTargets(entry) {
  const raw = entry?.target ?? entry?.targets ?? entry?.environment ?? entry?.environments ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  return sortedTargets(values.map((value) => {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && typeof value.name === "string") {
      return value.name;
    }
    return "";
  }));
}

function sortedTargets(targets) {
  return [...new Set(targets.map((target) => target.trim().toLowerCase()).filter(Boolean))].sort();
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Could not parse ${label}: ${message}`);
  }
}

function stripVercelBanner(stdout) {
  const objectStart = stdout.indexOf("{");
  const arrayStart = stdout.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) {
    return stdout;
  }
  return stdout.slice(Math.min(...starts));
}
