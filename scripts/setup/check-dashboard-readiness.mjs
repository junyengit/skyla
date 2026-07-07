import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const convex = runJsonScript("scripts/setup/check-convex-env.mjs");
const vercelProject = runJsonScript("scripts/setup/check-vercel-project.mjs");
const vercel = runJsonScript("scripts/setup/check-vercel-env.mjs");

const gates = {
  vercelProjectShape: Boolean(vercelProject.data?.readyForProjectShape),
  vercelConvexUrl: Boolean(vercel.data?.readyForConvexUrl),
  safeVercelSecretPlacement: Boolean(vercel.data?.safeSecretPlacement),
  convexCloudPersistence: Boolean(convex.data?.readyForCloudPersistence),
  stripeCheckout: Boolean(convex.data?.readyForStripeCheckout),
  stripeWebhook: Boolean(convex.data?.readyForStripeWebhook),
  terminalReaderHandoff: Boolean(convex.data?.readyForTerminalReaderHandoff),
  staffBootstrap: Boolean(convex.data?.readyForStaffBootstrap)
};

const readyForNoWritePreflight =
  gates.vercelProjectShape &&
  gates.vercelConvexUrl &&
  gates.safeVercelSecretPlacement &&
  gates.convexCloudPersistence &&
  gates.stripeCheckout &&
  gates.stripeWebhook;
const readyForTerminalAcceptance = readyForNoWritePreflight && gates.terminalReaderHandoff;
const status = readyForNoWritePreflight ? "linked_preflight_ready" : "dashboard_setup_required";
const nextActions = buildNextActions({
  gates,
  convex: convex.data,
  vercel: vercel.data,
  vercelProject: vercelProject.data
});

const output = {
  status,
  safeToUseRealCards: false,
  realCardPolicy: "Do not use real cards during migration verification. Use Stripe test cards/readers only after linked Preview acceptance passes.",
  readyForNoWritePreflight,
  readyForTerminalAcceptance,
  gates,
  nextActions,
  checks: {
    convex: summarizeCheck(convex),
    vercelProject: summarizeCheck(vercelProject),
    vercel: summarizeCheck(vercel)
  },
  commands: [
    "bun run vercel:project:check",
    "bun run vercel:env:check",
    "bun run convex:env:check",
    "bun run test:acceptance:preflight",
    "bun run test:acceptance:linked"
  ]
};

console.log(JSON.stringify(output, null, 2));

if (!readyForNoWritePreflight || convex.exitCode !== 0 || vercelProject.exitCode !== 0 || vercel.exitCode !== 0) {
  console.error("Dashboard readiness is not complete. See JSON output for nextActions.");
  process.exitCode = 1;
}

function runJsonScript(relativePath) {
  const result = spawnSync(process.execPath, [resolve(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8"
  });

  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    data: parseJsonObject(result.stdout),
    stderr: stripSensitiveText(result.stderr.trim())
  };
}

function parseJsonObject(stdout) {
  const start = firstJsonStart(stdout);
  if (start === -1) {
    return null;
  }
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

function firstJsonStart(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  return starts.length === 0 ? -1 : Math.min(...starts);
}

function summarizeCheck(result) {
  return {
    exitCode: result.exitCode,
    parsed: Boolean(result.data),
    error: result.stderr || undefined,
    data: result.data
  };
}

function buildNextActions({ gates, convex, vercel, vercelProject }) {
  const actions = [];

  if (!gates.vercelProjectShape) {
    actions.push({
      id: "fix-vercel-project-shape",
      owner: "vercel-dashboard-and-repo",
      priority: 1,
      action: "Keep Vercel linked to Junyen Enterprises/web with root apps/web, Next.js, Node 24.x, and keep apps/web/vercel.json as the Bun canary build authority.",
      command: "bun run vercel:project:check",
      evidence: failedCheckNames(vercelProject)
    });
  }

  if (!gates.safeVercelSecretPlacement) {
    const forbidden = (vercel?.forbidden ?? [])
      .filter((entry) => entry.present)
      .map((entry) => entry.key);
    const publicSecretLike = (vercel?.publicSecretLike ?? []).map((entry) => entry.key);
    actions.push({
      id: "clean-vercel-secrets",
      owner: "vercel-dashboard",
      priority: 1,
      action: "Remove Stripe, staff, Terminal, or secret-like public env names from Vercel; those belong in Convex or another secret manager.",
      evidence: [...forbidden, ...publicSecretLike]
    });
  }

  if (!gates.vercelConvexUrl) {
    actions.push({
      id: "add-vercel-convex-url",
      owner: "vercel-dashboard",
      priority: 2,
      action: "Add NEXT_PUBLIC_CONVEX_URL to Vercel Preview and Production after the real Convex cloud deployment exists.",
      command: "bun run vercel:env:check"
    });
  }

  if (!gates.convexCloudPersistence) {
    actions.push({
      id: "link-convex-cloud",
      owner: "convex-dashboard",
      priority: 3,
      action: "Create or link the real Skyla Convex cloud project; local anonymous Convex is not enough for production writes.",
      command: "bun run convex:env:check"
    });
  }

  if (!gates.stripeCheckout) {
    actions.push({
      id: "configure-stripe-checkout-env",
      owner: "convex-dashboard",
      priority: 4,
      action: "Set Convex SKYLA_STRIPE_MODE=test, STRIPE_SECRET_KEY with a test key, and SKYLA_PAYMENT_RETURN_ORIGINS with production and preview origins.",
      missing: missingConvexChecks(convex, ["SKYLA_STRIPE_MODE", "STRIPE_SECRET_KEY", "SKYLA_PAYMENT_RETURN_ORIGINS"])
    });
  }

  if (!gates.stripeWebhook) {
    actions.push({
      id: "configure-stripe-webhook",
      owner: "stripe-and-convex-dashboard",
      priority: 5,
      action: "Create a Stripe test webhook endpoint for Convex POST /stripe-webhook and set Convex STRIPE_WEBHOOK_SECRET.",
      missing: missingConvexChecks(convex, ["STRIPE_WEBHOOK_SECRET"])
    });
  }

  if (readyForNoWritePreflight) {
    actions.push({
      id: "run-linked-acceptance",
      owner: "operator",
      priority: 1,
      action: "Run linked Preview no-write preflight with a seeded staff test token before any write or reader acceptance.",
      command: "bun run test:acceptance:preflight"
    });
  }

  if (!readyForNoWritePreflight && !gates.staffBootstrap) {
    actions.push({
      id: "seed-staff",
      owner: "convex-dashboard",
      priority: 6,
      action: "Set a temporary Convex SKYLA_STAFF_BOOTSTRAP_TOKEN, seed the first staff user, then remove or rotate the bootstrap token.",
      missing: missingConvexChecks(convex, ["SKYLA_STAFF_BOOTSTRAP_TOKEN"])
    });
  }

  if (!gates.terminalReaderHandoff) {
    actions.push({
      id: "configure-terminal-reader",
      owner: "stripe-and-convex-dashboard",
      priority: 7,
      action: "Add Convex SKYLA_TERMINAL_READER_REGISTRY with Stripe test reader IDs, then set SKYLA_POS_TERMINAL_ACCEPTANCE=enabled only for the controlled test-reader attempt.",
      missing: missingConvexChecks(convex, ["SKYLA_TERMINAL_READER_REGISTRY", "SKYLA_POS_TERMINAL_ACCEPTANCE"])
    });
  }

  if (readyForTerminalAcceptance) {
    actions.push({
      id: "run-linked-write-acceptance",
      owner: "operator",
      priority: 8,
      action: "After no-write preflight passes, run linked Preview write acceptance with Stripe test cards/readers only.",
      command: "bun run test:acceptance:linked"
    });
  }

  return actions;
}

function missingConvexChecks(convex, names) {
  const checks = convex?.checks ?? [];
  return names.filter((name) => !checks.find((check) => check.name === name)?.ok);
}

function failedCheckNames(result) {
  return (result?.checks ?? []).filter((check) => !check.ok).map((check) => check.name);
}

function stripSensitiveText(value) {
  return value
    .replace(/sk_(test|live)_[A-Za-z0-9_]+/g, "sk_$1_[redacted]")
    .replace(/whsec_[A-Za-z0-9_]+/g, "whsec_[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, (match) => {
      if (/^(dpl_|prj_|team_|tmr_|tml_)/.test(match)) {
        return match;
      }
      return "[redacted]";
    });
}
