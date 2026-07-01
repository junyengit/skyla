import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [".env.local", "apps/web/.env.local"];

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    result[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

const fileEnv = Object.assign({}, ...files.map((file) => parseEnvFile(resolve(file))));
const env = { ...fileEnv, ...process.env };
const deployment = env.CONVEX_DEPLOYMENT ?? "";
const publicUrl = env.NEXT_PUBLIC_CONVEX_URL ?? "";
const serverUrl = env.CONVEX_URL ?? "";
const stripeSecretKey = env.STRIPE_SECRET_KEY ?? "";
const stripeReturnOrigins = env.SKYLA_PAYMENT_RETURN_ORIGINS ?? "";
const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET ?? "";
const terminalReaderRegistry = env.SKYLA_TERMINAL_READER_REGISTRY ?? "";
const stripeReturnOriginList = commaList(stripeReturnOrigins);
const terminalReaderRegistryList = commaList(terminalReaderRegistry);

const checks = [
  {
    name: "CONVEX_DEPLOYMENT",
    present: Boolean(deployment),
    ok: Boolean(deployment && !deployment.startsWith("anonymous")),
    note: deployment.startsWith("anonymous") ? "anonymous local deployment is not a cloud link" : undefined
  },
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    present: Boolean(publicUrl),
    ok: /^https:\/\/.+\.convex\.cloud$/.test(publicUrl),
    note: publicUrl ? "required by the Next checkout route on Vercel" : undefined
  },
  {
    name: "CONVEX_URL",
    present: Boolean(serverUrl),
    ok: /^https:\/\/.+\.convex\.cloud$/.test(serverUrl) || /^http:\/\/127\.0\.0\.1:\d+$/.test(serverUrl),
    note: serverUrl ? "useful for local server-side checks; production should prefer NEXT_PUBLIC_CONVEX_URL" : undefined
  },
  {
    name: "STRIPE_SECRET_KEY",
    present: Boolean(stripeSecretKey),
    ok: /^sk_(test|live)_/.test(stripeSecretKey),
    note: stripeSecretKey ? "required by Convex Stripe payment actions" : undefined
  },
  {
    name: "SKYLA_PAYMENT_RETURN_ORIGINS",
    present: Boolean(stripeReturnOrigins),
    ok: stripeReturnOriginList.length > 0 && stripeReturnOriginList.every((origin) => /^https?:\/\/[^/]+$/.test(origin)),
    note: stripeReturnOrigins ? "comma-separated origins only; no paths" : undefined
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    present: Boolean(stripeWebhookSecret),
    ok: /^whsec_/.test(stripeWebhookSecret),
    note: stripeWebhookSecret ? "required before Stripe paid-state reconciliation is trusted" : undefined
  },
  {
    name: "SKYLA_TERMINAL_READER_REGISTRY",
    present: Boolean(terminalReaderRegistry),
    ok: terminalReaderRegistryList.length > 0 &&
      terminalReaderRegistryList.every((entry) => /^tmr_[A-Za-z0-9_]+(@tml_[A-Za-z0-9_]+)?$/.test(entry)),
    note: terminalReaderRegistry ? "comma-separated reader or reader@location entries" : undefined
  }
];

const output = {
  filesChecked: files,
  readyForCloudPersistence: checks[0].ok && checks[1].ok,
  readyForStripeCheckout: checks[0].ok && checks[1].ok && checks[3].ok && checks[4].ok,
  readyForStripeWebhook: checks[0].ok && checks[5].ok,
  readyForTerminalReaderHandoff: checks[0].ok && checks[1].ok && checks[3].ok && checks[6].ok,
  checks
};

console.log(JSON.stringify(output, null, 2));

if (!output.readyForCloudPersistence) {
  process.exitCode = 1;
}

function commaList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
