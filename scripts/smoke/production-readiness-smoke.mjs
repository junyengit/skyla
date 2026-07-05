import { spawnSync } from "node:child_process";

const defaultBaseUrls = ["https://skydeckla.com", "https://www.skydeckla.com"];
const envBaseUrls = process.env.PRODUCTION_READINESS_BASE_URLS ?? process.env.SMOKE_BASE_URLS;
const baseUrls = uniqueUrls([
  ...(envBaseUrls ? envBaseUrls.split(",") : defaultBaseUrls),
  process.env.VERCEL_PRODUCTION_URL
]);
const mode = process.env.SKYLA_ACCEPTANCE_MODE ?? "no-write";

const staffStyles = [
  { path: "/admin.html", expected: "admin.css?v=8", label: "legacy admin stylesheet" },
  { path: "/pos.html", expected: "pos.css?v=10", label: "legacy POS fallback stylesheet" }
];

const publicHandoffs = ["/about", "/cafe", "/experiences", "/members", "/privacy", "/terms"];
const retiredPublicAssets = [
  "/about.css",
  "/cafe.css",
  "/experiences.css",
  "/members.css",
  "/styles.css",
  "/script.js"
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
  await checkPublicCompatibilityHandoffs(origin);
  await checkNativeAdminSurface(origin);
  await checkNativePosSurface(origin);
  await checkCheckoutPageNoLegacyWrites(origin);
  await checkMembersPageNoLegacyWrites(origin);
  await checkExperiencesPageNoLegacyWrites(origin);
  await checkMemberApplicationsNoWrite(origin);
  await checkExperienceInquiriesNoWrite(origin);
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
console.log("- Checkout compatibility page hands off to native /checkout without legacy payment scripts or assets.");
console.log("- Public .html compatibility pages hand off to native App Router pages without legacy page CSS/JS.");
console.log("- Native member pages do not expose the legacy localStorage/Supabase submission path.");
console.log("- Native experiences pages do not expose the legacy localStorage/Supabase inquiry path.");
console.log("- Member application no-write probe did not create data.");
console.log("- Experience inquiry no-write probe did not create data.");
console.log("- Legacy staff fallback pages reference the current dark stylesheet cache keys.");
console.log("- Native admin exposes the staff-gated booking lookup panel.");
console.log("- Native /pos renders the server-priced POS shell without legacy POS scripts.");
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

async function checkPublicCompatibilityHandoffs(origin) {
  for (const route of publicHandoffs) {
    const path = `${route}.html`;
    const response = await fetch(new URL(path, origin), { redirect: "manual" });
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${origin}${path}: expected HTTP 200, got ${response.status}`);
      continue;
    }

    for (const expected of [`url=${route}`, `href="${route}"`, "window.location.search", "window.location.hash"]) {
      if (!html.includes(expected)) {
        failures.push(`${origin}${path}: did not preserve handoff marker ${expected}`);
      }
    }

    for (const legacyMarker of [
      "shared-data.js",
      "SkylaData",
      "connect.facebook.net",
      'rel="stylesheet"',
      "styles.css",
      "script.js"
    ]) {
      if (html.includes(legacyMarker)) {
        failures.push(`${origin}${path}: exposed retired public compatibility marker ${legacyMarker}`);
      }
    }
  }

  for (const assetPath of retiredPublicAssets) {
    const response = await fetch(new URL(assetPath, origin), { redirect: "manual" });

    if (response.status === 200) {
      failures.push(`${origin}${assetPath}: retired public compatibility asset is still served`);
    }
  }
}

async function checkNativeAdminSurface(origin) {
  const response = await fetch(new URL("/admin", origin), { redirect: "follow" });
  const html = await response.text();

  if (response.status !== 200) {
    failures.push(`${origin}/admin: expected HTTP 200, got ${response.status}`);
    return;
  }

  if (!html.includes("Booking Lookup") || !html.includes("Staff Token")) {
    failures.push(`${origin}/admin: did not render native staff booking lookup controls`);
  }

  if (html.includes("SkylaData") || html.includes("shared-data.js")) {
    failures.push(`${origin}/admin: exposed legacy localStorage/Supabase admin path`);
  }
}

async function checkNativePosSurface(origin) {
  const response = await fetch(new URL("/pos", origin), { redirect: "follow" });
  const html = await response.text();

  if (response.status !== 200) {
    failures.push(`${origin}/pos: expected HTTP 200, got ${response.status}`);
    return;
  }

  for (const expected of ["Server-priced POS", "Current Sale", "Staff Token"]) {
    if (!html.includes(expected)) {
      failures.push(`${origin}/pos: did not render native POS control "${expected}"`);
    }
  }

  for (const legacyMarker of ["shared-data.js", "pos.js", "SkylaData", "LEGACY_TERMINAL_PAYMENTS_ENABLED", "clientSecret"]) {
    if (html.includes(legacyMarker)) {
      failures.push(`${origin}/pos: exposed legacy POS marker ${legacyMarker}`);
    }
  }
}

async function checkCheckoutPageNoLegacyWrites(origin) {
  for (const path of ["/checkout", "/checkout.html"]) {
    const response = await fetch(new URL(path, origin), { redirect: "follow" });
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${origin}${path}: expected HTTP 200, got ${response.status}`);
      continue;
    }

    const exposedSharedLegacy =
      html.includes("shared-data.js") ||
      html.includes("checkout.js") ||
      html.includes("checkout.css") ||
      html.includes("SkylaData") ||
      html.includes("SkylaData.addBooking") ||
      html.includes("KASKADE_ENABLED") ||
      html.includes("kaskade-payment");
    const exposedHandoffOnlyLegacy = path === "/checkout.html" && html.includes("stripe-checkout");

    if (exposedSharedLegacy || exposedHandoffOnlyLegacy) {
      failures.push(`${origin}${path}: exposed legacy browser-authoritative checkout path`);
    }

    if (path === "/checkout" && !html.includes("Server totals only")) {
      failures.push(`${origin}${path}: did not render the native checkout page`);
    }
  }

  for (const assetPath of ["/checkout.js", "/checkout.css"]) {
    const response = await fetch(new URL(assetPath, origin), { redirect: "manual" });

    if (response.status === 200) {
      failures.push(`${origin}${assetPath}: legacy checkout asset is still served`);
    }
  }
}

async function checkMembersPageNoLegacyWrites(origin) {
  for (const path of ["/members", "/members.html"]) {
    const response = await fetch(new URL(path, origin), { redirect: "follow" });
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${origin}${path}: expected HTTP 200, got ${response.status}`);
      continue;
    }

    if (html.includes("shared-data.js") || html.includes("SkylaData.addMember")) {
      failures.push(`${origin}${path}: exposed legacy member localStorage/Supabase write path`);
    }

    if (path === "/members" && !html.includes("Begin your application")) {
      failures.push(`${origin}${path}: did not render the native member application page`);
    }
  }
}

async function checkExperiencesPageNoLegacyWrites(origin) {
  for (const path of ["/experiences", "/experiences.html"]) {
    const response = await fetch(new URL(path, origin), { redirect: "follow" });
    const html = await response.text();

    if (response.status !== 200) {
      failures.push(`${origin}${path}: expected HTTP 200, got ${response.status}`);
      continue;
    }

    if (html.includes("shared-data.js") || html.includes("SkylaData.addInquiry")) {
      failures.push(`${origin}${path}: exposed legacy inquiry localStorage/Supabase write path`);
    }

    if (path === "/experiences" && !html.includes("Request Event Details")) {
      failures.push(`${origin}${path}: did not render the native experiences page`);
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

async function checkExperienceInquiriesNoWrite(origin) {
  const response = await fetch(new URL("/api/experiences/inquiries", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const json = await response.json().catch(() => null);

  if (response.status === 503 && json?.code === "convex_unconfigured") {
    notes.push(`${origin} experience inquiries remain safely Convex-gated.`);
    return;
  }

  if (response.status === 400 && String(json?.error ?? "").includes("firstName is required")) {
    notes.push(`${origin} experience inquiry route reached validation before any write.`);
    return;
  }

  failures.push(
    `${origin}/api/experiences/inquiries: expected no-write 503 convex_unconfigured or 400 validation, got ${response.status}`
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
