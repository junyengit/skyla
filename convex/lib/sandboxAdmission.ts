import {
  rejectedSandboxDeployment,
  sandboxAdmission,
  sandboxAdmissionOpenAt,
  strictSandboxAdmissionOrigin
} from "@skyla/config";

// The backend half of the admission sandbox. It trusts only this deployment's
// own system URLs and its own Stripe and origin settings, never the web
// server's claim, so a misconfigured web tier still cannot open sales here.
type SandboxBackendEnv = Record<string, string | undefined>;

export type BackendSandboxAdmissionClosedReason =
  | "not_opted_in"
  | "rejected_backend"
  | "backend_unpinned"
  | "expired"
  | "stripe_not_test"
  | "stripe_key_not_test"
  | "origin_unapproved";

export type BackendSandboxAdmissionDecision =
  | { open: true }
  | { open: false; reason: BackendSandboxAdmissionClosedReason };

export function backendSandboxAdmissionDecision(
  env: SandboxBackendEnv,
  now: number
): BackendSandboxAdmissionDecision {
  if (env.SKYLA_SANDBOX_ADMISSION !== sandboxAdmission.deployment) return closed("not_opted_in");
  if (rejectedSandboxDeployment(env.CONVEX_CLOUD_URL) || rejectedSandboxDeployment(env.CONVEX_SITE_URL)) {
    return closed("rejected_backend");
  }
  if (
    env.CONVEX_CLOUD_URL !== sandboxAdmission.convexCloudUrl ||
    env.CONVEX_SITE_URL !== sandboxAdmission.convexSiteUrl
  ) {
    return closed("backend_unpinned");
  }
  if (!sandboxAdmissionOpenAt(now)) return closed("expired");
  if (env.SKYLA_STRIPE_MODE !== "test") return closed("stripe_not_test");
  // Same trimming as configuredStripeSecret; restricted and live keys never match.
  if (!/^sk_test_\S+$/.test(env.STRIPE_SECRET_KEY?.trim() ?? "")) return closed("stripe_key_not_test");

  const origin = strictSandboxAdmissionOrigin(env.SKYLA_SANDBOX_ADMISSION_ORIGIN);
  if (!origin || env.SKYLA_PUBLIC_ORIGIN !== origin || env.SKYLA_PAYMENT_RETURN_ORIGINS !== origin) {
    return closed("origin_unapproved");
  }

  return { open: true };
}

function closed(reason: BackendSandboxAdmissionClosedReason): BackendSandboxAdmissionDecision {
  return { open: false, reason };
}
