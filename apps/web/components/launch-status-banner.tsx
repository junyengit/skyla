import { siteConfig } from "@skyla/config";

// Server-rendered availability band. Non-dismissible by design so the current
// booking model is clear on every public surface.
export function LaunchStatusBanner() {
  return (
    <div className="launchBanner" role="status">
      <strong className="launchBannerLabel">Full venue bookings only</strong>
      <span className="launchBannerMessage">
        Individual tickets are not available. Inquire about exclusive use of the entire top floor.
      </span>
      <a className="launchBannerEmail" href={`mailto:${siteConfig.email}`}>
        {siteConfig.email}
      </a>
    </div>
  );
}
