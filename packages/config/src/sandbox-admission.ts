// The one reviewed admission sandbox: the isolated Convex Preview created on
// 2026-10-09 with a four-day provider expiry, reached only from the Junyen
// Vercel Preview of this branch. Every identity is pinned here so pointing the
// sandbox anywhere else takes a reviewed code change, never an environment edit.
export const sandboxAdmission = Object.freeze({
  deployment: "bold-reindeer-495",
  convexCloudUrl: "https://bold-reindeer-495.convex.cloud",
  convexSiteUrl: "https://bold-reindeer-495.convex.site",
  // About a day before the provider expiry, so a lapsing backend is never trusted.
  closesAt: Date.parse("2026-10-12T04:00:00Z"),
  vercelProjectId: "prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr",
  vercelBranch: "codex/skydeck-sandbox-gate-20261003"
});

// The revoked October 3 Preview and the original Development and Production
// backends. They stay closed even when every other sandbox setting is valid.
export const sandboxAdmissionRejectedDeployments = Object.freeze([
  "grand-ferret-807",
  "disciplined-chickadee-688",
  "perceptive-fox-396"
] as const);

const previewHostPrefix = "web-git-";
const previewHostSuffix = "-junyen-enterprises";
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function sandboxAdmissionOpenAt(now: number) {
  return Number.isFinite(now) && now < sandboxAdmission.closesAt;
}

/**
 * Returns the value only when it is exactly `https://` plus one Git-branch
 * host of Junyen's `web` project under vercel.app. Ports, paths, queries,
 * fragments, credentials, uppercase, trailing dots, and lists never match.
 */
export function strictSandboxAdmissionOrigin(value: string | undefined) {
  if (typeof value !== "string" || !value.startsWith("https://") || !value.endsWith(".vercel.app")) {
    return undefined;
  }
  const label = value.slice("https://".length, -".vercel.app".length);
  if (
    !dnsLabel.test(label) ||
    !label.startsWith(previewHostPrefix) ||
    !label.endsWith(previewHostSuffix) ||
    label.length <= previewHostPrefix.length + previewHostSuffix.length
  ) {
    return undefined;
  }
  return value;
}

export function rejectedSandboxDeployment(value: string | undefined) {
  return typeof value === "string" && sandboxAdmissionRejectedDeployments.some((name) => value.includes(name));
}
