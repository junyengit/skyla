import { describe, expect, it } from "vitest";

import {
  rejectedSandboxDeployment,
  sandboxAdmission,
  sandboxAdmissionOpenAt,
  sandboxAdmissionRejectedDeployments,
  siteConfig,
  strictSandboxAdmissionOrigin
} from "./index";

// Test fixture only: shaped like Junyen's Vercel Git-branch hosts. It is not
// the deployed Preview hostname, which the source never guesses.
const fixtureBranchHost = "web-git-sandbox-fixture-junyen-enterprises.vercel.app";
const fixtureOrigin = `https://${fixtureBranchHost}`;

describe("sandbox admission binding", () => {
  it("pins the one reviewed Preview backend, project, branch, and cutoff", () => {
    expect(sandboxAdmission).toEqual({
      deployment: "bold-reindeer-495",
      convexCloudUrl: "https://bold-reindeer-495.convex.cloud",
      convexSiteUrl: "https://bold-reindeer-495.convex.site",
      closesAt: Date.parse("2026-10-12T04:00:00Z"),
      vercelProjectId: "prj_fhlOjcwSbnPAuLi8tTiGbhjVomnr",
      vercelBranch: "codex/skydeck-sandbox-gate-20261003"
    });
    expect(Object.isFrozen(sandboxAdmission)).toBe(true);
    expect(Object.isFrozen(sandboxAdmissionRejectedDeployments)).toBe(true);
  });

  it("closes before the provider's four-day Preview expiry", () => {
    // Created 2026-10-09T04:19Z with --expiration "in 4 days".
    const providerExpiry = Date.parse("2026-10-09T04:19:06Z") + 4 * 24 * 60 * 60 * 1000;
    expect(sandboxAdmission.closesAt).toBeLessThan(providerExpiry);
  });

  it("leaves the public transaction gate closed", () => {
    expect(siteConfig.launched).toBe(false);
  });

  it.each([
    ["inside the window", Date.parse("2026-10-10T18:00:00Z"), true],
    ["one millisecond before the cutoff", Date.parse("2026-10-12T04:00:00Z") - 1, true],
    ["at the cutoff", Date.parse("2026-10-12T04:00:00Z"), false],
    ["after the cutoff", Date.parse("2026-10-13T00:00:00Z"), false],
    ["an invalid clock", Number.NaN, false]
  ])("is open %s => %s", (_label, now, open) => {
    expect(sandboxAdmissionOpenAt(now)).toBe(open);
  });

  it.each([
    "https://grand-ferret-807.convex.cloud",
    "https://grand-ferret-807.convex.site",
    "https://disciplined-chickadee-688.convex.cloud",
    "https://perceptive-fox-396.convex.site"
  ])("names %s as a rejected backend", (url) => {
    expect(rejectedSandboxDeployment(url)).toBe(true);
  });

  it("does not reject the pinned backend", () => {
    expect(rejectedSandboxDeployment(sandboxAdmission.convexCloudUrl)).toBe(false);
    expect(rejectedSandboxDeployment(undefined)).toBe(false);
  });
});

describe("strict sandbox admission origin", () => {
  it("accepts a bare HTTPS Junyen web Git-branch origin", () => {
    expect(strictSandboxAdmissionOrigin(fixtureOrigin)).toBe(fixtureOrigin);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["bare host", fixtureBranchHost],
    ["http", `http://${fixtureBranchHost}`],
    ["trailing slash", `${fixtureOrigin}/`],
    ["path", `${fixtureOrigin}/checkout`],
    ["query", `${fixtureOrigin}?stripe=success`],
    ["fragment", `${fixtureOrigin}#tickets`],
    ["explicit default port", `https://${fixtureBranchHost}:443`],
    ["explicit port", `https://${fixtureBranchHost}:8443`],
    ["credentials", `https://guest:pw@${fixtureBranchHost}`],
    ["uppercase", fixtureOrigin.toUpperCase()],
    ["mixed case host", "https://Web-git-sandbox-fixture-junyen-enterprises.vercel.app"],
    ["trailing dot", `${fixtureOrigin}.`],
    ["surrounding space", ` ${fixtureOrigin} `],
    ["list", `${fixtureOrigin},https://skydeckla.com`],
    ["production domain", "https://skydeckla.com"],
    ["www production domain", "https://www.skydeckla.com"],
    ["localhost", "http://localhost:3000"],
    ["unique deployment URL", "https://web-a1b2c3d4e-junyen-enterprises.vercel.app"],
    ["production vercel.app alias", "https://web-junyen-enterprises.vercel.app"],
    ["another project", "https://admin-git-sandbox-fixture-junyen-enterprises.vercel.app"],
    ["another team", "https://web-git-sandbox-fixture-other-team.vercel.app"],
    ["empty branch", "https://web-git--junyen-enterprises.vercel.app"],
    ["nested subdomain", `https://preview.${fixtureBranchHost}`],
    ["lookalike suffix", "https://web-git-sandbox-fixture-junyen-enterprises.vercel.app.example.com"],
    ["custom preview suffix", "https://web-git-sandbox-fixture-junyen-enterprises.skydeckla.com"],
    ["over-long DNS label", `https://web-git-${"a".repeat(40)}-junyen-enterprises.vercel.app`]
  ])("rejects %s", (_label, value) => {
    expect(strictSandboxAdmissionOrigin(value)).toBeUndefined();
  });
});
