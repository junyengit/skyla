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
const stripeMode = env.SKYLA_STRIPE_MODE ?? "";
const stripeSecretKey = env.STRIPE_SECRET_KEY ?? "";
const stripeReturnOrigins = env.SKYLA_PAYMENT_RETURN_ORIGINS ?? "";
const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET ?? "";
const terminalReaderRegistry = env.SKYLA_TERMINAL_READER_REGISTRY ?? "";
const terminalAcceptance = env.SKYLA_POS_TERMINAL_ACCEPTANCE ?? "";
const staffBootstrapToken = env.SKYLA_STAFF_BOOTSTRAP_TOKEN ?? "";
const clerkIssuerDomain = env.CLERK_JWT_ISSUER_DOMAIN ?? "";
const resendApiKey = env.RESEND_API_KEY ?? "";
const ticketFromEmail = env.SKYLA_TICKET_FROM_EMAIL ?? "";
const ticketReplyTo = env.SKYLA_TICKET_REPLY_TO ?? "";
const publicOrigin = env.SKYLA_PUBLIC_ORIGIN ?? "";
const publicGatewaySecret = env.SKYLA_PUBLIC_GATEWAY_SECRET ?? "";
const requiredGateNames = commaList(env.SKYLA_CONVEX_ENV_REQUIRE ?? "");
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
    name: "SKYLA_STRIPE_MODE",
    present: Boolean(stripeMode),
    ok: stripeMode === "test" || stripeMode === "live",
    note: stripeMode ? "must match the Stripe key and webhook mode" : undefined
  },
  {
    name: "STRIPE_SECRET_KEY",
    present: Boolean(stripeSecretKey),
    ok: /^sk_(test|live)_/.test(stripeSecretKey) &&
      (stripeMode === "test" ? stripeSecretKey.startsWith("sk_test_") : true) &&
      (stripeMode === "live" ? stripeSecretKey.startsWith("sk_live_") : true),
    note: stripeSecretKey ? "required by Convex Stripe payment actions and must match SKYLA_STRIPE_MODE" : undefined
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
  },
  {
    name: "SKYLA_POS_TERMINAL_ACCEPTANCE",
    present: Boolean(terminalAcceptance),
    ok: terminalAcceptance === "enabled",
    note: terminalAcceptance ? "must be enabled only after Stripe test-reader acceptance passes" : undefined
  },
  {
    name: "SKYLA_STAFF_BOOTSTRAP_TOKEN",
    present: Boolean(staffBootstrapToken),
    ok: staffBootstrapToken.length >= 32 && !/\s/.test(staffBootstrapToken),
    note: staffBootstrapToken
      ? "temporary Convex-only token for seeding staffUsers; remove or rotate after staff is seeded"
      : undefined
  },
  {
    name: "CLERK_JWT_ISSUER_DOMAIN",
    present: Boolean(clerkIssuerDomain),
    ok: /^https:\/\/(?:[a-z0-9-]+\.clerk\.accounts\.dev|clerk\.[a-z0-9.-]+\.[a-z]{2,})$/.test(clerkIssuerDomain),
    note: clerkIssuerDomain ? "must exactly match the Clerk Convex integration Frontend API URL" : undefined
  },
  {
    name: "RESEND_API_KEY",
    present: Boolean(resendApiKey),
    ok: /^re_[A-Za-z0-9_-]{8,}$/.test(resendApiKey),
    note: resendApiKey ? "Convex-only provider key for ticket confirmation email" : undefined
  },
  {
    name: "SKYLA_TICKET_FROM_EMAIL",
    present: Boolean(ticketFromEmail),
    ok: senderEmailIsValid(ticketFromEmail),
    note: ticketFromEmail ? "must use a sender on the verified Resend domain" : undefined
  },
  {
    name: "SKYLA_TICKET_REPLY_TO",
    present: Boolean(ticketReplyTo),
    ok: !ticketReplyTo || emailIsValid(ticketReplyTo),
    note: ticketReplyTo ? "optional monitored reply address" : undefined
  },
  {
    name: "SKYLA_PUBLIC_ORIGIN",
    present: Boolean(publicOrigin),
    ok: httpsOriginIsValid(publicOrigin),
    note: publicOrigin ? "bare HTTPS origin used in ticket email links and QR codes" : undefined
  },
  {
    name: "SKYLA_PUBLIC_GATEWAY_SECRET",
    present: Boolean(publicGatewaySecret),
    ok: publicGatewaySecret.length >= 32 && publicGatewaySecret.length <= 256 && !/\s/.test(publicGatewaySecret),
    note: publicGatewaySecret ? "server-only shared secret for authenticated Next-to-Convex public writes" : undefined
  }
];

const gates = {
  cloud: checks[0].ok && checks[1].ok,
  "public-gateway": checks[0].ok && checks[1].ok && checks[15].ok,
  "stripe-checkout": checks[0].ok && checks[1].ok && checks[3].ok && checks[4].ok && checks[5].ok && checks[15].ok,
  "stripe-webhook": checks[0].ok && checks[3].ok && checks[6].ok,
  "terminal-reader":
    checks[0].ok && checks[1].ok && checks[3].ok && checks[4].ok && checks[6].ok && checks[7].ok && checks[8].ok,
  "staff-bootstrap": checks[0].ok && checks[9].ok,
  "staff-auth": checks[0].ok && checks[1].ok && checks[10].ok,
  "ticket-email": checks[0].ok && checks[11].ok && checks[12].ok && checks[13].ok && checks[14].ok
};

const allowedRequiredGates = Object.keys(gates);
const requiredGates = allowedRequiredGates.filter((name) => requiredGateNames.includes(name)).map((name) => ({
  name,
  ok: gates[name]
}));
const unknownRequiredGateCount = requiredGateNames.length - requiredGates.length;

const output = {
  filesChecked: files,
  readyForCloudPersistence: gates.cloud,
  readyForPublicGateway: gates["public-gateway"],
  readyForStripeCheckout: gates["stripe-checkout"],
  readyForStripeWebhook: gates["stripe-webhook"],
  readyForTerminalReaderHandoff: gates["terminal-reader"],
  readyForStaffBootstrap: gates["staff-bootstrap"],
  readyForStaffAuth: gates["staff-auth"],
  readyForTicketEmail: gates["ticket-email"],
  allowedRequiredGates,
  requiredGates,
  unknownRequiredGateCount,
  checks
};

console.log(JSON.stringify(output, null, 2));

const failedRequiredGates = requiredGates.filter((gate) => !gate.ok);

if (unknownRequiredGateCount > 0) {
  console.error(
    `Unknown SKYLA_CONVEX_ENV_REQUIRE gate count: ${unknownRequiredGateCount}. See allowedRequiredGates in JSON output.`
  );
  process.exitCode = 1;
} else if (requiredGateNames.length > 0 && failedRequiredGates.length > 0) {
  console.error("One or more required Convex env gates are not ready. See requiredGates in JSON output.");
  process.exitCode = 1;
} else if (requiredGateNames.length === 0 && !output.readyForCloudPersistence) {
  process.exitCode = 1;
}

function commaList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emailIsValid(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

function senderEmailIsValid(value) {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^[^<>]{1,80}<([^<>]+)>$/);
  return emailIsValid(bracketed?.[1] ?? trimmed);
}

function httpsOriginIsValid(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}
