import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const forbiddenPathPatterns = [
  /^output\//,
  /^tmp\//,
  /(^|\/)\.env(\.|$)/,
  /\.(csv|xlsx|pdf|log|pem|p12|pfx|key)$/i
];

const allowedPathPatterns = [
  /(^|\/)\.env\.(example|sample|template)$/i,
  /^docs\/marketing\/google-ads\/google-ads-negative-keywords\.csv$/,
  /^docs\/marketing\/google-ads\/google-search-(ad-copy|campaign-keywords)\.csv$/
];

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
  const isAllowedTemplate = allowedPathPatterns.some((pattern) => pattern.test(file));
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
