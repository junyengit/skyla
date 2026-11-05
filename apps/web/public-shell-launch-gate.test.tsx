import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@skyla/config";

import ErrorPage from "./app/error";
import GlobalError from "./app/global-error";
import LiabilityWaiverPage from "./app/liability-waiver/page";
import NotFound from "./app/not-found";
import PrivacyPage from "./app/privacy/page";
import TermsPage from "./app/terms/page";
import { PublicPageShell } from "./components/public-page-shell";

// Every public shell must derive launch state from the canonical config: while
// `siteConfig.launched` is false no public entry route may render a purchase
// CTA, and each mounts the shared status band with a usable email link.
function expectPreLaunchGate(html: string) {
  expect(html).not.toContain("Buy Tickets");
  expect(html).toContain(`<span class="navStatus">${siteConfig.launchStatus.label}</span>`);
  expect(html).toContain('role="status"');
  expect(html).toContain(siteConfig.launchStatus.message);
  expect(html).toContain(`mailto:${siteConfig.email}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public shells during pre-launch", () => {
  it("keeps /privacy free of a purchase CTA and mounts the status band", () => {
    expect(siteConfig.launched).toBe(false);
    expectPreLaunchGate(renderToStaticMarkup(<PrivacyPage />));
  });

  it("keeps /terms free of a purchase CTA and mounts the status band", () => {
    expectPreLaunchGate(renderToStaticMarkup(<TermsPage />));
  });

  it("keeps /liability-waiver free of a purchase CTA and mounts the status band", () => {
    expectPreLaunchGate(renderToStaticMarkup(<LiabilityWaiverPage />));
  });

  it("keeps the not-found surface free of a purchase CTA", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expectPreLaunchGate(html);
    expect(html).toContain('class="publicPage prelaunch"');
  });

  it("keeps the route error boundary free of a purchase CTA", () => {
    const html = renderToStaticMarkup(<ErrorPage error={new Error("boom")} reset={() => undefined} />);
    expectPreLaunchGate(html);
    expect(html).toContain('class="publicPage prelaunch"');
  });

  it("keeps the shared public page shell free of a purchase CTA", () => {
    const html = renderToStaticMarkup(
      <PublicPageShell active="checkout">
        <div />
      </PublicPageShell>
    );
    expectPreLaunchGate(html);
    expect(html).toContain('class="publicPage prelaunch"');
  });

  it("keeps the global error document free of a purchase CTA", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={new Error("boom")} reset={() => undefined} />
    );
    expect(html).not.toContain("Buy Tickets");
  });
});

describe("public shells after launch", () => {
  it("restores the Buy Tickets CTA and drops the status band when launched", () => {
    vi.spyOn(siteConfig, "launched", "get").mockReturnValue(true);

    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("Buy Tickets");
    expect(html).toContain('href="/checkout"');
    expect(html).not.toContain("navStatus");
    expect(html).not.toContain('role="status"');
  });
});
