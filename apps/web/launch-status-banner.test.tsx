import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@skyla/config";

import { LaunchStatusBanner } from "./components/launch-status-banner";

describe("LaunchStatusBanner", () => {
  it("renders the canonical pre-launch status with the reservations email link", () => {
    expect(siteConfig.launched).toBe(false);

    const html = renderToStaticMarkup(<LaunchStatusBanner />);

    expect(html).toContain('role="status"');
    expect(html).toContain(siteConfig.launchStatus.label);
    expect(html).toContain(siteConfig.launchStatus.message);
    expect(html).toContain(`mailto:${siteConfig.email}`);
  });
});
