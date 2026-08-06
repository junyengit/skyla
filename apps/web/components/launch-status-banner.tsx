import { siteConfig } from "@skyla/config";

// Server-rendered pre-launch status band. Non-dismissible by design so the
// launch truth cannot be hidden, and returns null after launch so callers
// never gate it themselves.
export function LaunchStatusBanner() {
  if (siteConfig.launched) return null;

  return (
    <div className="launchBanner" role="status">
      <strong className="launchBannerLabel">{siteConfig.launchStatus.label}</strong>
      <span className="launchBannerMessage">{siteConfig.launchStatus.message}</span>
      <a className="launchBannerEmail" href={`mailto:${siteConfig.email}`}>
        {siteConfig.email}
      </a>
    </div>
  );
}
