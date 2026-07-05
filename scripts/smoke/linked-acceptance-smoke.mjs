import { randomUUID } from "node:crypto";

const failures = [];
const notes = [];

const mode = process.env.SKYLA_ACCEPTANCE_MODE;
const baseUrlValue = process.env.ACCEPTANCE_BASE_URL;
const expectedStripeMode = process.env.SKYLA_ACCEPTANCE_STRIPE_MODE;
const staffToken = process.env.SKYLA_STAFF_TEST_TOKEN;
const noRealCardsAck = process.env.SKYLA_ACCEPTANCE_NO_REAL_CARDS === "1";
const allowProduction = process.env.SKYLA_ALLOW_PRODUCTION_ACCEPTANCE === "1";
const runStripeCheckout = process.env.SKYLA_ACCEPTANCE_STRIPE_CHECKOUT === "1";
const runTerminalReader = process.env.SKYLA_ACCEPTANCE_TERMINAL_READER === "1";

if (mode !== "linked-test") {
  fail("setup", "set SKYLA_ACCEPTANCE_MODE=linked-test to run linked acceptance");
}

let baseUrl;
try {
  baseUrl = baseUrlValue ? new URL(baseUrlValue) : undefined;
} catch {
  fail("setup", `ACCEPTANCE_BASE_URL is not a valid URL: ${baseUrlValue}`);
}

if (!baseUrl) {
  fail("setup", "set ACCEPTANCE_BASE_URL to the Vercel preview URL under test");
} else if (
  baseUrl.protocol !== "https:" &&
  baseUrl.hostname !== "localhost" &&
  baseUrl.hostname !== "127.0.0.1"
) {
  fail("setup", "linked acceptance must run against HTTPS or localhost");
}

const targetKind = baseUrl ? classifyTarget(baseUrl) : "unknown";
if (baseUrl && targetKind === "production" && !allowProduction) {
  fail(
    "setup",
    "refusing production-domain linked acceptance without SKYLA_ALLOW_PRODUCTION_ACCEPTANCE=1; use the web-git-* Vercel Preview alias"
  );
}

if (baseUrl && targetKind !== "preview" && targetKind !== "local" && targetKind !== "production") {
  fail("setup", "refusing direct or unknown target; use the web-git-* Vercel Preview alias");
}

if (expectedStripeMode !== "test") {
  fail("setup", "set SKYLA_ACCEPTANCE_STRIPE_MODE=test while running acceptance; never use live mode here");
}

if (!noRealCardsAck) {
  fail(
    "setup",
    "set SKYLA_ACCEPTANCE_NO_REAL_CARDS=1 to acknowledge that only Stripe test mode/test readers are allowed"
  );
}

if (!staffToken) {
  fail("setup", "set SKYLA_STAFF_TEST_TOKEN to a seeded test admin or POS staff token");
}

if (failures.length > 0) {
  printFailures();
  process.exit(1);
}

const runId = randomUUID().replaceAll("-", "").slice(0, 18);
const customerEmail = `acceptance+${runId}@example.com`;
const headers = { authorization: `Bearer ${staffToken}` };

const readinessUnauthenticated = await getJson("/api/admin/acceptance-readiness");
expectStatus("acceptance readiness unauthenticated", readinessUnauthenticated, 401);
expect(
  "acceptance readiness unauthenticated",
  readinessUnauthenticated.json?.code === "staff_auth_required",
  "expected staff_auth_required"
);

const readiness = await getJson("/api/admin/acceptance-readiness", headers);
expectStatus("acceptance readiness", readiness, 200);
expectNoClientSecret("acceptance readiness", readiness);
expect("acceptance readiness", readiness.json?.stripe?.mode === "test", "remote Convex SKYLA_STRIPE_MODE must be test");

if (runStripeCheckout) {
  expect(
    "acceptance readiness",
    readiness.json?.stripe?.checkoutReady === true,
    "remote Stripe Checkout readiness must be true before creating a test Checkout Session"
  );
}

if (runTerminalReader) {
  expect(
    "acceptance readiness",
    readiness.json?.terminal?.readerProcessingReady === true,
    "remote Terminal reader readiness must be true before processing a test reader payment"
  );
}

if (failures.length > 0) {
  printFailures();
  process.exit(1);
}

const checkoutDraft = await postJson("/api/order-drafts/checkout", {
  packageKey: "general",
  adults: 2,
  children: 1,
  addons: { matcha: 1 },
  customerEmail,
  idempotencyKey: `acc_checkout_${runId}`,
  totalCents: 1,
  amountCents: 1
});

expectStatus("checkout draft", checkoutDraft, 200);
expect("checkout draft", checkoutDraft.json?.persisted === true, "expected persisted: true from linked Convex");
expect("checkout draft", typeof checkoutDraft.json?.orderRef === "string", "expected orderRef");
expect("checkout draft", checkoutDraft.json?.draft?.totalCents > 1, "expected canonical server total");
expect("checkout draft", checkoutDraft.json?.draft?.totalCents !== 1, "browser total was trusted");
expectNoClientSecret("checkout draft", checkoutDraft);

const memberApplication = await postJson("/api/members/applications", {
  firstName: "Acceptance",
  lastName: "Member",
  email: customerEmail,
  phone: "555-0100",
  tier: "gold",
  source: "linked-acceptance-smoke",
  bio: "Automated linked acceptance test record.",
  idempotencyKey: `acc_member_${runId}`
});

expectStatus("member application", memberApplication, 201);
expect("member application", memberApplication.json?.member?.status === "pending", "expected pending member");
expect("member application", memberApplication.json?.member?.emailLower === customerEmail, "expected normalized email");
expectNoClientSecret("member application", memberApplication);

const memberReplay = await postJson("/api/members/applications", {
  firstName: "Acceptance",
  lastName: "Member",
  email: customerEmail,
  phone: "555-0100",
  tier: "gold",
  source: "linked-acceptance-smoke",
  bio: "Automated linked acceptance test record.",
  idempotencyKey: `acc_member_${runId}`
});

expectStatus("member idempotency replay", memberReplay, 200);
expect("member idempotency replay", memberReplay.json?.member?.replayed === true, "expected replayed: true");

const inquiry = await postJson("/api/experiences/inquiries", {
  firstName: "Acceptance",
  lastName: "Inquiry",
  email: customerEmail,
  experience: "private-events",
  eventDate: "2026-08-20",
  guestCount: "9-12",
  notes: "Automated linked acceptance inquiry.",
  source: "linked-acceptance-smoke",
  idempotencyKey: `acc_inquiry_${runId}`
});

expectStatus("experience inquiry", inquiry, 201);
expect("experience inquiry", inquiry.json?.inquiry?.status === "pending", "expected pending inquiry");
expect("experience inquiry", inquiry.json?.inquiry?.emailLower === customerEmail, "expected normalized email");
expectNoClientSecret("experience inquiry", inquiry);

const readersUnauthenticated = await getJson("/api/pos/readers");
expectStatus("POS readers unauthenticated", readersUnauthenticated, 401);
expect(
  "POS readers unauthenticated",
  readersUnauthenticated.json?.code === "staff_auth_required",
  "expected staff_auth_required"
);

const readers = await getJson("/api/pos/readers", headers);
expectStatus("POS readers authenticated", readers, 200);
expect("POS readers authenticated", Array.isArray(readers.json?.readers), "expected readers array");
expect("POS readers authenticated", readers.json?.readers?.length > 0, "expected at least one test reader");
expectNoClientSecret("POS readers authenticated", readers);

const firstReader = readers.json?.readers?.[0];
if (firstReader?.readerId) {
  const posDraft = await postJson(
    "/api/order-drafts/pos",
    {
      lines: [{ kind: "ticket", packageKey: "general", quantity: 2, unitAmountCents: 1 }],
      customerEmail,
      readerId: firstReader.readerId,
      idempotencyKey: `acc_pos_${runId}`,
      totalCents: 1,
      terminalLocationId: "tml_browser_supplied"
    },
    headers
  );

  expectStatus("POS draft", posDraft, 200);
  expect("POS draft", posDraft.json?.persisted === true, "expected persisted POS sale draft");
  expect("POS draft", typeof posDraft.json?.saleRef === "string", "expected saleRef");
  expect("POS draft", posDraft.json?.draft?.totalCents > 1, "expected canonical POS total");
  expect("POS draft", posDraft.json?.draft?.totalCents !== 1, "browser POS total was trusted");
  expect(
    "POS draft",
    posDraft.json?.draft?.terminalLocationId !== "tml_browser_supplied",
    "browser Terminal location was trusted"
  );
  expectNoClientSecret("POS draft", posDraft);

  await maybeRunTerminalReaderAcceptance(posDraft.json?.saleRef, runId, headers);
}

if (failures.length > 0) {
  printFailures();
  process.exit(1);
}

if (runStripeCheckout) {
  const checkoutPayment = await postJson(
    "/api/payments/stripe-checkout",
    {
      orderRef: checkoutDraft.json?.orderRef,
      idempotencyKey: `acc_stripe_checkout_${runId}`,
      amountCents: 1
    },
    { origin: baseUrl.origin }
  );

  expectStatus("Stripe Checkout session", checkoutPayment, 200);
  expect("Stripe Checkout session", checkoutPayment.json?.provider === "stripe", "expected provider stripe");
  expect("Stripe Checkout session", checkoutPayment.json?.orderRef === checkoutDraft.json?.orderRef, "orderRef mismatch");
  expect(
    "Stripe Checkout session",
    checkoutPayment.json?.amountCents === checkoutDraft.json?.draft?.totalCents,
    "Stripe amount did not match stored checkout draft"
  );
  expect(
    "Stripe Checkout session",
    typeof checkoutPayment.json?.url === "string" && checkoutPayment.json.url.startsWith("https://checkout.stripe.com/"),
    "expected Stripe Checkout URL"
  );
  expectNoClientSecret("Stripe Checkout session", checkoutPayment);
  notes.push("Stripe Checkout test-mode session creation passed.");
} else {
  notes.push(
    "Stripe Checkout session creation skipped; set SKYLA_ACCEPTANCE_STRIPE_CHECKOUT=1 after test-mode Stripe envs are configured."
  );
}

if (failures.length > 0) {
  printFailures();
  process.exit(1);
}

console.log(`Linked persistence acceptance passed for ${baseUrl.origin}.`);
console.log(`- Checkout draft persisted as ${checkoutDraft.json.orderRef}.`);
console.log(`- Member application and experience inquiry persisted with idempotent public APIs.`);
console.log(`- POS reader registry and POS sale draft persisted with staff auth.`);
for (const note of notes) {
  console.log(`- ${note}`);
}

async function maybeRunTerminalReaderAcceptance(saleRef, id, authHeaders) {
  if (!runTerminalReader) {
    notes.push(
      "Terminal reader processing skipped; set SKYLA_ACCEPTANCE_TERMINAL_READER=1 only with a Stripe test reader ready."
    );
    return;
  }

  const terminalPayment = await postJson(
    "/api/payments/stripe-terminal",
    {
      saleRef,
      idempotencyKey: `acc_terminal_create_${id}`,
      amountCents: 1,
      readerId: "tmr_browser_supplied"
    },
    authHeaders
  );

  expectStatus("Stripe Terminal PaymentIntent", terminalPayment, 200);
  expect("Stripe Terminal PaymentIntent", terminalPayment.json?.saleRef === saleRef, "saleRef mismatch");
  expect("Stripe Terminal PaymentIntent", terminalPayment.json?.provider === "terminal", "expected provider terminal");
  expectNoClientSecret("Stripe Terminal PaymentIntent", terminalPayment);

  const terminalProcess = await postJson(
    "/api/payments/stripe-terminal/process",
    {
      saleRef,
      idempotencyKey: `acc_terminal_process_${id}`,
      readerId: "tmr_browser_supplied"
    },
    authHeaders
  );

  expectStatus("Stripe Terminal reader process", terminalProcess, 200);
  expect("Stripe Terminal reader process", terminalProcess.json?.saleRef === saleRef, "saleRef mismatch");
  expect("Stripe Terminal reader process", terminalProcess.json?.provider === "terminal", "expected provider terminal");
  expectNoClientSecret("Stripe Terminal reader process", terminalProcess);
  notes.push("Stripe Terminal test-reader processing passed.");
}

async function postJson(path, body, extraHeaders = {}) {
  return requestJson(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

async function getJson(path, extraHeaders = {}) {
  return requestJson(path, {
    headers: extraHeaders
  });
}

async function requestJson(path, init) {
  const response = await fetch(new URL(path, baseUrl), init);
  const text = await response.text();
  let json = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    fail(path, `expected JSON response, got ${text.slice(0, 160)}`);
  }
  return { path, status: response.status, json, text };
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

function expectNoClientSecret(label, result) {
  expect(label, !hasSensitiveStripeField(result.json), "response exposed a clientSecret/client_secret field");
}

function expectStatus(label, result, status) {
  expect(
    label,
    result.status === status,
    `expected HTTP ${status}, got ${result.status}: ${result.text.slice(0, 160)}`
  );
}

function expect(label, condition, message) {
  if (!condition) {
    fail(label, message);
  }
}

function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

function classifyTarget(url) {
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return "local";
  }
  if (url.hostname === "skydeckla.com" || url.hostname === "www.skydeckla.com") {
    return "production";
  }
  if (/^web-git-(?!main(?:-|\.))[a-z0-9-]+-junyen-enterprises\.vercel\.app$/i.test(url.hostname)) {
    return "preview";
  }
  if (url.hostname.endsWith(".vercel.app")) {
    return "vercel-unknown";
  }
  return "unknown";
}

function printFailures() {
  console.error("Linked acceptance smoke failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
}
