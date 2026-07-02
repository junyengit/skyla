import { spawnSync } from "node:child_process";

const defaultBaseUrls = ["https://skydeckla.com", "https://www.skydeckla.com"];
const envBaseUrls = process.env.PRODUCTION_READINESS_BASE_URLS ?? process.env.SMOKE_BASE_URLS;
const baseUrls = uniqueUrls([
  ...(envBaseUrls ? envBaseUrls.split(",") : defaultBaseUrls),
  process.env.VERCEL_PRODUCTION_URL
]);
const mode = process.env.SKYLA_ACCEPTANCE_MODE ?? "no-write";

const staffStyles = [
  { path: "/admin.html", expected: "admin.css?v=6", label: "legacy admin stylesheet" },
  { path: "/pos", expected: "pos.css?v=8", label: "legacy POS stylesheet" }
];

const failures = [];
const notes = [];

if (mode !== "no-write") {
  failures.push(
    `SKYLA_ACCEPTANCE_MODE=${mode} is not implemented here; use the Convex/Stripe runbooks for explicit test-mode write acceptance`
  );
}

for (const baseUrl of baseUrls) {
  const origin = new URL(baseUrl).origin;
  runSmokeScript(origin, "route matrix", "scripts/smoke/route-smoke.mjs", { SMOKE_BASE_URL: origin });
  await checkPaymentNoWrite(origin);
  await checkStaffStyles(origin);
  await checkMemberApplicationsNoWrite(origin);
}

if (failures.length > 0) {
  console.error("Production readiness smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Production readiness smoke passed.");
console.log(`- Checked bases: ${baseUrls.map((url) => new URL(url).origin).join(", ")}`);
console.log("- Route matrix and noindex headers passed.");
console.log("- Payment no-write probes kept server-owned totals and stopped before Stripe execution.");
console.log("- Member application no-write probe did not create data.");
console.log("- Legacy staff pages reference the current dark stylesheet cache keys.");
for (const note of notes) {
  console.log(`- ${note}`);
}

function runSmokeScript(origin, label, script, extraEnv) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failures.push(`${origin} ${label}: ${trimOutput(result.stderr || result.stdout || "unknown failure")}`);
  }
}

async function checkStaffStyles(origin) {
  for (const style of staffStyles) {
    const response = await fetch(new URL(style.path, origin), { redirect: "follow" });
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${origin}${style.path}: expected HTTP 200, got ${response.status}`);
      continue;
    }

    if (!html.includes(style.expected)) {
      failures.push(`${origin}${style.path}: expected ${style.label} ${style.expected}`);
    }
  }
}

async function checkPaymentNoWrite(origin) {
  const checkoutDraft = await postJson(origin, "/api/order-drafts/checkout", {
    packageKey: "general",
    adults: 2,
    children: 1,
    addons: { matcha: 1 },
    totalCents: 1,
    amountCents: 1
  });

  expectStatus(origin, "checkout draft", checkoutDraft, 200);
  expect(
    origin,
    "checkout draft",
    checkoutDraft.json?.draft?.totalCents > 1,
    "browser-spoofed total was not replaced"
  );
  expect(
    origin,
    "checkout draft",
    ["convex_unconfigured", "idempotencyKey_required"].includes(checkoutDraft.json?.persistenceReason),
    `expected no-write persistence reason, got ${checkoutDraft.json?.persistenceReason ?? "none"}`
  );
  expectNoClientSecret(origin, "checkout draft", checkoutDraft);

  const posDraft = await postJson(origin, "/api/order-drafts/pos", {
    totalCents: 1,
    amountCents: 1,
    lines: [
      { kind: "ticket", packageKey: "drink", quantity: 2, unitAmountCents: 1 },
      { kind: "cafe", itemKey: "b1", quantity: 3, priceCents: 1 },
      { kind: "custom", name: "Service recovery", amountCents: 500, quantity: 1, reason: "Manager approved" }
    ],
    customerEmail: "GUEST@EXAMPLE.COM",
    readerId: "tmr_browser_supplied",
    terminalLocationId: "tml_browser_supplied"
  });

  expectStatus(origin, "POS draft", posDraft, 200);
  expect(origin, "POS draft", posDraft.json?.draft?.totalCents > 1, "browser-spoofed POS total was not replaced");
  expect(origin, "POS draft", posDraft.json?.draft?.readerId === undefined, "transient draft included browser readerId");
  expect(
    origin,
    "POS draft",
    posDraft.json?.draft?.terminalLocationId === undefined,
    "transient draft included browser terminalLocationId"
  );
  expect(
    origin,
    "POS draft",
    ["convex_unconfigured", "idempotencyKey_required", "staff_auth_required"].includes(posDraft.json?.persistenceReason),
    `expected no-write persistence reason, got ${posDraft.json?.persistenceReason ?? "none"}`
  );
  expectNoClientSecret(origin, "POS draft", posDraft);

  const checkoutPayment = await postJson(origin, "/api/payments/stripe-checkout", {});
  if (checkoutPayment.status === 503) {
    expect(
      origin,
      "Stripe Checkout no-write",
      checkoutPayment.json?.code === "convex_unconfigured",
      `expected convex_unconfigured, got ${checkoutPayment.json?.code ?? "none"}`
    );
  } else {
    expectStatus(origin, "Stripe Checkout no-write", checkoutPayment, 400);
    expect(
      origin,
      "Stripe Checkout no-write",
      String(checkoutPayment.json?.error ?? "").includes("orderRef is required"),
      "expected validation before action execution"
    );
  }
  expectNoClientSecret(origin, "Stripe Checkout no-write", checkoutPayment);

  const terminalPayment = await postJson(origin, "/api/payments/stripe-terminal", {});
  expectStatus(origin, "Stripe Terminal no-write", terminalPayment, 401);
  expect(
    origin,
    "Stripe Terminal no-write",
    terminalPayment.json?.code === "staff_auth_required",
    `expected staff_auth_required, got ${terminalPayment.json?.code ?? "none"}`
  );
  expectNoClientSecret(origin, "Stripe Terminal no-write", terminalPayment);

  const terminalProcess = await postJson(origin, "/api/payments/stripe-terminal/process", {});
  expectStatus(origin, "Stripe Terminal process no-write", terminalProcess, 401);
  expect(
    origin,
    "Stripe Terminal process no-write",
    terminalProcess.json?.code === "staff_auth_required",
    `expected staff_auth_required, got ${terminalProcess.json?.code ?? "none"}`
  );
  expectNoClientSecret(origin, "Stripe Terminal process no-write", terminalProcess);
}

async function checkMemberApplicationsNoWrite(origin) {
  const response = await fetch(new URL("/api/members/applications", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const json = await response.json().catch(() => null);

  if (response.status === 503 && json?.code === "convex_unconfigured") {
    notes.push(`${origin} member applications remain safely Convex-gated.`);
    return;
  }

  if (response.status === 400 && String(json?.error ?? "").includes("firstName is required")) {
    notes.push(`${origin} member application route reached validation before any write.`);
    return;
  }

  failures.push(
    `${origin}/api/members/applications: expected no-write 503 convex_unconfigured or 400 validation, got ${response.status}`
  );
}

async function postJson(origin, path, body) {
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;

  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    failures.push(`${origin}${path}: expected JSON response, got ${text.slice(0, 120)}`);
  }

  return { status: response.status, json };
}

function expectStatus(origin, label, result, expectedStatus) {
  expect(origin, label, result.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${result.status}`);
}

function expect(origin, label, condition, message) {
  if (!condition) {
    failures.push(`${origin} ${label}: ${message}`);
  }
}

function expectNoClientSecret(origin, label, result) {
  expect(origin, label, !hasSensitiveStripeField(result.json), "response exposed clientSecret/client_secret");
}

function hasSensitiveStripeField(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasSensitiveStripeField(item));
  }
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replaceAll("_", "");
    return normalizedKey === "clientsecret" || hasSensitiveStripeField(nestedValue);
  });
}

function uniqueUrls(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin)
    )
  );
}

function trimOutput(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}
