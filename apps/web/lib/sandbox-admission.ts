import {
  rejectedSandboxDeployment,
  sandboxAdmission,
  sandboxAdmissionOpenAt,
  strictSandboxAdmissionOrigin
} from "@skyla/config";

import { convexSiteUrl } from "./public-convex-gateway";

// Test checkout for the single reviewed Vercel Preview, while
// `siteConfig.launched` stays false everywhere else. Identity comes only from
// server environment; request headers are compared against the approved
// origin but never decide whether this deployment is the sandbox.
export const sandboxAdmissionOptInFlag = "SKYLA_SANDBOX_ADMISSION";
export const sandboxAdmissionOriginSetting = "SKYLA_SANDBOX_ADMISSION_ORIGIN";

type SandboxEnvKey =
  | "NODE_ENV"
  | "VERCEL"
  | "VERCEL_ENV"
  | "VERCEL_TARGET_ENV"
  | "VERCEL_PROJECT_ID"
  | "VERCEL_GIT_COMMIT_REF"
  | "VERCEL_BRANCH_URL"
  | "VERCEL_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "SKYLA_STRIPE_MODE"
  | "SKYLA_PUBLIC_ORIGIN"
  | "CONVEX_SITE_URL"
  | "CONVEX_URL"
  | "NEXT_PUBLIC_CONVEX_URL"
  | typeof sandboxAdmissionOptInFlag
  | typeof sandboxAdmissionOriginSetting;

type SandboxEnv = Partial<Record<SandboxEnvKey, string>>;

export type SandboxAdmissionClosedReason =
  | "not_opted_in"
  | "not_vercel_preview"
  | "wrong_vercel_project"
  | "wrong_branch"
  | "stripe_not_test"
  | "expired"
  | "rejected_backend"
  | "backend_unpinned"
  | "origin_unapproved"
  | "public_origin_mismatch";

export type SandboxAdmissionDecision =
  | { open: true; origin: string }
  | { open: false; reason: SandboxAdmissionClosedReason };

// public-convex-gateway forwards to the first configured slot in this order.
const gatewayTargets = [
  ["CONVEX_SITE_URL", sandboxAdmission.convexSiteUrl],
  ["CONVEX_URL", sandboxAdmission.convexCloudUrl],
  ["NEXT_PUBLIC_CONVEX_URL", sandboxAdmission.convexCloudUrl]
] as const;

export function sandboxAdmissionDecision(
  env: SandboxEnv = process.env,
  now = Date.now()
): SandboxAdmissionDecision {
  if (env[sandboxAdmissionOptInFlag] !== sandboxAdmission.deployment) return closed("not_opted_in");
  if (
    env.NODE_ENV !== "production" ||
    env.VERCEL !== "1" ||
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_TARGET_ENV !== "preview"
  ) {
    return closed("not_vercel_preview");
  }
  if (env.VERCEL_PROJECT_ID !== sandboxAdmission.vercelProjectId) return closed("wrong_vercel_project");
  if (env.VERCEL_GIT_COMMIT_REF !== sandboxAdmission.vercelBranch) return closed("wrong_branch");
  if (env.SKYLA_STRIPE_MODE !== "test") return closed("stripe_not_test");
  if (!sandboxAdmissionOpenAt(now)) return closed("expired");

  const backend = gatewayTargetProblem(env);
  if (backend) return closed(backend);

  const origin = approvedOrigin(env);
  if (!origin) return closed("origin_unapproved");
  // Ticket QR links must lead back to the same Preview, not production.
  if (env.SKYLA_PUBLIC_ORIGIN !== origin) return closed("public_origin_mismatch");

  return { open: true, origin };
}

/**
 * The approved purchase origin when this server is the verified sandbox, else
 * undefined. Also confirms the gateway client resolves to the pinned backend,
 * so the gate never approves one URL while forwarding to another.
 */
export function verifiedSandboxAdmissionOrigin(now = Date.now()) {
  // The literal NODE_ENV read is the build mode Next.js compiled in.
  const decision = sandboxAdmissionDecision({ ...process.env, NODE_ENV: process.env.NODE_ENV }, now);
  if (!decision.open) return undefined;
  try {
    return convexSiteUrl() === sandboxAdmission.convexSiteUrl ? decision.origin : undefined;
  } catch {
    // An unresolvable gateway is simply not the sandbox; the normal gate stays closed.
    return undefined;
  }
}

/**
 * True only when the request's Origin header and its own URL are both exactly
 * the approved origin. Forwarded headers never stand in for either; when
 * present they must agree with it.
 */
export function sandboxPurchaseRequestAllowed(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) return false;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.port ||
    !request.url.startsWith(`${origin}/`)
  ) {
    return false;
  }

  return forwardedHeadersAgree(request.headers, origin.slice("https://".length));
}

function closed(reason: SandboxAdmissionClosedReason): SandboxAdmissionDecision {
  return { open: false, reason };
}

function gatewayTargetProblem(env: SandboxEnv): SandboxAdmissionClosedReason | undefined {
  const configured = gatewayTargets.filter(([key]) => env[key] !== undefined && env[key] !== "");
  if (configured.some(([key]) => rejectedSandboxDeployment(env[key]))) return "rejected_backend";
  // Every configured slot must already be the pinned pair, so no precedence
  // order or override can reach a different backend.
  if (!configured.length || configured.some(([key, pinned]) => env[key] !== pinned)) return "backend_unpinned";
  return undefined;
}

function approvedOrigin(env: SandboxEnv) {
  const origin = strictSandboxAdmissionOrigin(env[sandboxAdmissionOriginSetting]);
  if (!origin || !env.VERCEL_BRANCH_URL || origin !== `https://${env.VERCEL_BRANCH_URL}`) return undefined;
  // The stable branch URL is the only alias. The per-deployment URL changes on
  // every redeploy and the production URL is never a sandbox address.
  if (env.VERCEL_URL && origin === `https://${env.VERCEL_URL}`) return undefined;
  if (env.VERCEL_PROJECT_PRODUCTION_URL && origin === `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) {
    return undefined;
  }
  return origin;
}

function forwardedHeadersAgree(headers: Headers, host: string) {
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost !== null && forwardedHost !== host) return false;
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedProto !== null && forwardedProto !== "https") return false;

  const forwarded = headers.get("forwarded");
  if (forwarded === null) return true;
  return forwarded.split(/[,;]/).every((pair) => {
    if (!pair.trim()) return true;
    const separator = pair.indexOf("=");
    if (separator < 0) return false;
    const name = pair.slice(0, separator).trim().toLowerCase();
    const value = pair.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
    if (name === "host") return value === host;
    if (name === "proto") return value === "https";
    return true;
  });
}
