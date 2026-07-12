import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webDir = import.meta.dirname;
const provider = readFileSync(join(webDir, "components/staff-auth-provider.tsx"), "utf8");
const admin = readFileSync(join(webDir, "components/admin-ops-client.tsx"), "utf8");
const pos = readFileSync(join(webDir, "components/pos-draft-client.tsx"), "utf8");
const proxy = readFileSync(join(webDir, "proxy.ts"), "utf8");
const convexAuth = readFileSync(join(webDir, "../../convex/auth.config.ts"), "utf8");
const signIn = readFileSync(join(webDir, "components/staff-sign-in.tsx"), "utf8");
const signInPage = readFileSync(join(webDir, "app/staff-sign-in/[[...staff-sign-in]]/page.tsx"), "utf8");
const config = readFileSync(join(webDir, "lib/staff-auth-config.ts"), "utf8");

describe("staff authentication UI", () => {
  it("uses short-lived Clerk tokens without browser token fields or storage", () => {
    expect(provider).toContain("await getToken()");
    expect(provider).toContain('getToken({ template: "convex" })');
    expect(provider).toContain('sessionClaims?.aud === "convex"');
    expect(provider).toContain("<Fragment key={sessionKey}>");
    expect(provider).toContain("approvedStaffApiUrl(input, window.location.origin)");
    expect(provider).toContain('status: "unconfigured"');
    expect(provider).not.toContain("localStorage");
    expect(provider).not.toContain("sessionStorage");

    for (const source of [admin, pos]) {
      expect(source).toContain("useStaffSession");
      expect(source).toContain("staffSession.staffFetch(");
      expect(source).not.toContain("staffSession.getToken");
      expect(source).not.toContain("Authorization");
      expect(source).not.toContain("Staff Token");
      expect(source).not.toContain("Bearer token");
      expect(source).not.toContain("staffToken");
    }
  });

  it("keeps Clerk optional until dashboards are configured", () => {
    expect(proxy).toContain("if (!clerkConfigured() || !event) return NextResponse.next()");
    expect(provider).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(config).toContain("CLERK_SECRET_KEY");
    expect(config).toContain('import "server-only"');
    expect(convexAuth).toContain("CLERK_JWT_ISSUER_DOMAIN");
    expect(convexAuth).toContain('applicationID: "convex"');
  });

  it("restricts post-sign-in navigation to native staff routes", () => {
    expect(signIn).toContain("forceRedirectUrl={returnTo}");
    expect(signInPage).toContain('new Set(["/admin", "/pos", "/pos-next"] as const)');
    expect(signInPage).not.toContain("redirect_url");
  });

  it("stops Terminal processing when the staff session changes after intent creation", () => {
    const createIntent = pos.indexOf('staffSession.staffFetch("/api/payments/stripe-terminal"');
    const processIntent = pos.indexOf('staffSession.staffFetch("/api/payments/stripe-terminal/process"');

    expect(createIntent).toBeGreaterThan(-1);
    expect(processIntent).toBeGreaterThan(createIntent);
    expect(pos.slice(createIntent, processIntent)).toContain("authEpoch !== authEpochRef.current");
  });
});
