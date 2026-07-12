import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const forbiddenPathPatterns = [
  /^output\//,
  /^tmp\//,
  /^\.migration\//,
  /(^|\/)\.env(\.|$)/,
  /\.(csv|xlsx|pdf|log|pem|p12|pfx|key)$/i
];

const allowedPathPatterns = [
  /(^|\/)\.env\.(example|sample|template)$/i,
  /^docs\/marketing\/google-ads\/google-ads-negative-keywords\.csv$/,
  /^docs\/marketing\/google-ads\/google-search-(ad-copy|campaign-keywords)\.csv$/
];

const legacyRootCompatibilityFiles = new Set([
  "CNAME",
  "about.css",
  "about.html",
  "admin.css",
  "admin.html",
  "admin.js",
  "ads-tracking.js",
  "cafe.css",
  "cafe.html",
  "checkout.css",
  "checkout.html",
  "checkout.js",
  "experiences.css",
  "experiences.html",
  "favicon.ico",
  "index.html",
  "members.css",
  "members.html",
  "pos.css",
  "pos.html",
  "pos.js",
  "privacy.html",
  "robots.txt",
  "script.js",
  "shared-data.js",
  "sitemap.xml",
  "styles.css",
  "terms.html"
]);

const legacyRootPathPatterns = [/^images\//, /^marketing\//];

const retiredPublicCompatibilityFiles = new Set([
  "apps/web/legacy-routes.mjs",
  "apps/web/public/about.html",
  "apps/web/public/admin.html",
  "apps/web/public/cafe.html",
  "apps/web/public/checkout.html",
  "apps/web/public/experiences.html",
  "apps/web/public/members.html",
  "apps/web/public/pos.html",
  "apps/web/public/privacy.html",
  "apps/web/public/robots.txt",
  "apps/web/public/sitemap.xml",
  "apps/web/public/terms.html"
]);

const nonBunPackageManagerFiles = new Set(["package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock"]);

const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/
];

const namedSecretAssignment =
  /\b(?:STRIPE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|KASKADE_API_SECRET)\b\s*[:=]\s*["']?([^"',\s;]+)/i;

const retiredLegacyPaymentFlags = [
  ["SKYLA_ENABLE", "LEGACY_BROWSER_PAYMENTS"].join("_"),
  ["SKYLA_ENABLE", "LEGACY_TERMINAL_BRIDGE"].join("_")
];

const retiredLegacyPaymentPatterns = [
  {
    pattern: /\bKASKADE_ENABLED\s*=\s*true\b/,
    message: "legacy Kaskade browser-authoritative checkout must stay disabled"
  },
  {
    pattern: /\bLEGACY_ADMIN_MUTATIONS_ENABLED\s*=\s*true\b/,
    message: "legacy admin fallback writes must stay disabled"
  },
  {
    pattern: /\bLEGACY_TERMINAL_READER_SETUP_ENABLED\s*=\s*true\b/,
    message: "legacy Terminal reader setup must stay disabled"
  },
  {
    pattern: /action\s*:\s*["']setup-reader["']/,
    message: "legacy browser-reachable Terminal reader setup must not be reintroduced"
  },
  {
    pattern: /payload\.action\s*===\s*["']setup-reader["']/,
    message: "legacy Supabase Terminal setup-reader handling must stay retired"
  },
  {
    pattern: /payload\.action\s*===\s*["']verify["']/,
    message: "legacy Supabase Stripe Checkout verification must stay retired"
  },
  {
    pattern: /\/checkout\/sessions\/\$\{sessionId\}/,
    message: "legacy Supabase Stripe Checkout session lookup must stay retired"
  },
  {
    pattern: /WEBHOOK_SECRET\.(?:length|slice)\b/,
    message: "webhook signature errors must not expose secret diagnostics"
  },
  {
    pattern: /secret_len=/,
    message: "webhook signature errors must not expose secret diagnostics"
  }
];

const binaryExtensions = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
  ".ico"
]);

const trackedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8"
})
  .split("\0")
  .filter(Boolean);

const failures = [];

for (const file of trackedFiles) {
  if (!existsSync(file)) {
    continue;
  }

  const isAllowedTemplate = allowedPathPatterns.some((pattern) => pattern.test(file));
  const isLegacyRootCompatibilityFile =
    legacyRootCompatibilityFiles.has(file) || legacyRootPathPatterns.some((pattern) => pattern.test(file));
  if (isLegacyRootCompatibilityFile) {
    failures.push(`${file}: legacy compatibility assets belong under apps/web/public, not the repo root`);
    continue;
  }

  if (retiredPublicCompatibilityFiles.has(file)) {
    failures.push(`${file}: App Router now owns this route; keep compatibility in apps/web/site-routes.mjs`);
    continue;
  }

  if (nonBunPackageManagerFiles.has(file)) {
    failures.push(`${file}: Skyla uses Bun canary with text bun.lock; do not reintroduce alternate package-manager files`);
    continue;
  }

  if (!isAllowedTemplate && forbiddenPathPatterns.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden tracked artifact path`);
    continue;
  }

  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")).toLowerCase() : "";
  if (binaryExtensions.has(extension)) {
    continue;
  }

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (contents.includes("\0")) {
    continue;
  }

  if (file !== "scripts/security/check-tracked-artifacts.mjs") {
    for (const flag of retiredLegacyPaymentFlags) {
      if (contents.includes(flag)) {
        failures.push(`${file}: retired legacy payment flag ${flag} must not be reintroduced`);
        break;
      }
    }

    for (const { pattern, message } of retiredLegacyPaymentPatterns) {
      if (pattern.test(contents)) {
        failures.push(`${file}: ${message}`);
        break;
      }
    }
  }

  for (const pattern of secretPatterns) {
    if (pattern.test(contents)) {
      failures.push(`${file}: potential secret matched ${pattern.source}`);
      break;
    }
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("#") || trimmedLine.startsWith("*")) {
      continue;
    }

    const match = trimmedLine.match(namedSecretAssignment);
    const value = match?.[1];
    if (value && !value.includes("...") && !/^placeholder$/i.test(value) && value.length >= 12) {
      failures.push(`${file}: potential named secret assignment`);
      break;
    }
  }
}

if (failures.length > 0) {
  console.error("Tracked artifact/security guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Tracked artifact/security guard passed for ${trackedFiles.length} tracked or untracked files.`);
