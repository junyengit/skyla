import { spawnSync } from "node:child_process";
import {
  htmlCompatibilityRedirects,
  staffHtmlCompatibilityRedirects
} from "../../apps/web/site-routes.mjs";
import { paymentDraftProvenanceIssues } from "./payment-provenance.mjs";

const defaultBaseUrls = ["https://skydeckla.com", "https://www.skydeckla.com"];
const envBaseUrls = process.env.PRODUCTION_READINESS_BASE_URLS ?? process.env.SMOKE_BASE_URLS;
const baseUrls = uniqueUrls([
  ...(envBaseUrls ? envBaseUrls.split(",") : defaultBaseUrls),
  process.env.VERCEL_PRODUCTION_URL
]);
const mode = process.env.SKYLA_ACCEPTANCE_MODE ?? "no-write";

const retiredStaffAssets = ["/admin.css", "/admin.js", "/pos.css", "/pos.js", "/shared-data.js"];
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
  await checkCompatibilityRedirects(origin);
  await checkRetiredCompatibilityAssets(origin);
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
console.log("- Payment no-write probes kept server-owned totals, catalog provenance, and stopped before Stripe execution.");
console.log("- Acceptance readiness API stays staff-gated before exposing linked-mode state.");
console.log("- Saved .html URLs redirect through the shared App Router route registry.");
console.log("- Native member pages do not expose the legacy localStorage/Supabase submission path.");
console.log("- Native experiences pages do not expose the legacy localStorage/Supabase inquiry path.");
console.log("- Member application no-write probe did not create data.");
console.log("- Experience inquiry no-write probe did not create data.");
console.log("- Retired public and staff compatibility assets are not served.");
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

async function checkCompatibilityRedirects(origin) {
  for (const { source, destination } of htmlCompatibilityRedirects) {
    const url = new URL(source, origin);
    url.searchParams.set("skyla_compat", "1");
    const response = await fetch(url, { redirect: "manual" });

    if (response.status !== 308) {
      failures.push(`${origin}${source}: expected permanent 308 redirect, got ${response.status}`);
      continue;
    }

    const location = response.headers.get("location");
    if (!location) {
      failures.push(`${origin}${source}: redirect did not include Location`);
      continue;
    }

    const target = new URL(location, origin);
    if (target.pathname !== destination) {
      failures.push(`${origin}${source}: expected redirect to ${destination}, got ${target.pathname}`);
    }
    if (target.searchParams.get("skyla_compat") !== "1") {
      failures.push(`${origin}${source}: redirect did not preserve the query string`);
    }
    if (
      staffHtmlCompatibilityRedirects.some((redirect) => redirect.source === source) &&
      response.headers.get("x-robots-tag") !== "noindex, nofollow"
    ) {
      failures.push(`${origin}${source}: staff compatibility redirect is missing X-Robots-Tag noindex, nofollow`);
    }
  }
}

async function checkRetiredCompatibilityAssets(origin) {
  for (const assetPath of [...retiredStaffAssets, ...retiredPublicAssets]) {
    const response = await fetch(new URL(assetPath, origin), { redirect: "manual" });

    if (response.status === 200) {
      failures.push(`${origin}${assetPath}: retired compatibility asset is still served`);
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

  if (!html.includes("Booking Lookup") || !hasStaffAccessState(html)) {
    failures.push(`${origin}/admin: did not render native staff booking lookup controls`);
  }

  if (html.includes("SkylaData") || html.includes("shared-data.js") || exposesPastedStaffToken(html)) {
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

  for (const expected of ["Server-priced POS", "Current Sale"]) {
    if (!html.includes(expected)) {
      failures.push(`${origin}/pos: did not render native POS control "${expected}"`);
    }
  }

  if (!hasStaffAccessState(html)) {
    failures.push(`${origin}/pos: did not render a staff access state`);
  }

  for (const legacyMarker of ["shared-data.js", "pos.js", "SkylaData", "LEGACY_TERMINAL_PAYMENTS_ENABLED", "clientSecret"]) {
    if (html.includes(legacyMarker)) {
      failures.push(`${origin}/pos: exposed legacy POS marker ${legacyMarker}`);
    }
  }

  if (exposesPastedStaffToken(html)) {
    failures.push(`${origin}/pos: exposed a pasted staff token control`);
  }
}

function hasStaffAccessState(html) {
  return ["Staff sign in", "Setup required", "Checking staff session", "Identity verified"].some((marker) =>
    html.includes(marker)
  );
}

function exposesPastedStaffToken(html) {
  return html.includes("Staff Token") || html.includes("Bearer token");
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

    if (path === "/checkout" && !html.includes('data-native-checkout="true"')) {
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
    amountCents: 1,
    metadata: { catalogVersion: "browser-spoof" },
    catalogVersion: "browser-spoof"
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
      {
        kind: "ticket",
        packageKey: "drink",
        quantity: 2,
        unitAmountCents: 1,
        metadata: { catalogVersion: "browser-spoof" }
      },
      { kind: "cafe", itemKey: "b1", quantity: 3, priceCents: 1, catalogVersion: "browser-spoof" },
      {
        kind: "custom",
        name: "Service recovery",
        amountCents: 500,
        quantity: 1,
        reason: "Manager approved",
        metadata: { catalogAuthority: "browser-spoof" }
      }
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

  for (const issue of paymentDraftProvenanceIssues({ checkoutDraft: checkoutDraft.json, posDraft: posDraft.json })) {
    failures.push(`${origin} payment draft provenance: ${issue}`);
  }

  const posReaders = await getJson(origin, "/api/pos/readers");
  expectStatus(origin, "POS reader registry no-write", posReaders, 401);
  expect(
    origin,
    "POS reader registry no-write",
    posReaders.json?.code === "staff_auth_required",
    `expected staff_auth_required, got ${posReaders.json?.code ?? "none"}`
  );
  expectNoClientSecret(origin, "POS reader registry no-write", posReaders);

  const acceptanceReadiness = await getJson(origin, "/api/admin/acceptance-readiness");
  expectStatus(origin, "Acceptance readiness no-write", acceptanceReadiness, 401);
  expect(
    origin,
    "Acceptance readiness no-write",
    acceptanceReadiness.json?.code === "staff_auth_required",
    `expected staff_auth_required, got ${acceptanceReadiness.json?.code ?? "none"}`
  );
  expectNoClientSecret(origin, "Acceptance readiness no-write", acceptanceReadiness);

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

async function getJson(origin, path) {
  const response = await fetch(new URL(path, origin));
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
