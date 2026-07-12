import { paymentDraftProvenanceIssues } from "./payment-provenance.mjs";

const baseUrl = new URL(process.env.PAYMENT_SMOKE_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "https://www.skydeckla.com");

const fakeStaffToken = "smoke.fake.staff.token";
const failures = [];

function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

function expect(label, condition, message) {
  if (!condition) {
    fail(label, message);
  }
}

async function postJson(path, body, headers = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;

  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    fail(path, `expected JSON response, got ${text.slice(0, 120)}`);
  }

  return {
    path,
    status: response.status,
    headers: response.headers,
    json,
    text
  };
}

async function getJson(path, headers = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    headers
  });
  const text = await response.text();
  let json = null;

  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    fail(path, `expected JSON response, got ${text.slice(0, 120)}`);
  }

  return {
    path,
    status: response.status,
    headers: response.headers,
    json,
    text
  };
}

function hasSensitiveStripeField(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== "object") {
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

function expectFailClosed(label, result, expectedStatus, expectedCode) {
  expect(label, result.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${result.status}`);
  expect(label, result.json?.code === expectedCode, `expected code ${expectedCode}, got ${result.json?.code ?? "none"}`);
  expectNoClientSecret(label, result);
}

function expectFailClosedCode(label, result, expectedStatus, expectedCodes) {
  expect(label, result.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${result.status}`);
  expect(
    label,
    expectedCodes.includes(result.json?.code),
    `expected code ${expectedCodes.join(" or ")}, got ${result.json?.code ?? "none"}`
  );
  expectNoClientSecret(label, result);
}

function expectNoStore(label, result) {
  expect(label, result.headers.get("cache-control") === "no-store", "expected Cache-Control: no-store");
}

function expectAuthorizationVary(label, result) {
  const vary = result.headers.get("vary") ?? "";
  const hasAuthorization = vary
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes("authorization");
  expect(label, hasAuthorization, "expected Vary: Authorization");
}

const checkoutDraft = await postJson("/api/order-drafts/checkout", {
  packageKey: "general",
  adults: 2,
  children: 1,
  addons: { matcha: 1 },
  totalCents: 1,
  amountCents: 1,
  metadata: { catalogVersion: "browser-spoof" },
  catalogVersion: "browser-spoof"
});

expect("checkout draft", checkoutDraft.status === 200, `expected HTTP 200, got ${checkoutDraft.status}`);
expect("checkout draft", checkoutDraft.json?.draft?.totalCents > 1, "browser-spoofed total was not replaced");
expect(
  "checkout draft",
  ["convex_unconfigured", "idempotencyKey_required"].includes(checkoutDraft.json?.persistenceReason),
  `expected no-write persistence reason, got ${checkoutDraft.json?.persistenceReason ?? "none"}`
);
expectNoClientSecret("checkout draft", checkoutDraft);

const posDraft = await postJson("/api/order-drafts/pos", {
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

expect("POS draft", posDraft.status === 200, `expected HTTP 200, got ${posDraft.status}`);
expect("POS draft", posDraft.json?.draft?.totalCents > 1, "browser-spoofed POS total was not replaced");
expect("POS draft", posDraft.json?.draft?.readerId === undefined, "transient draft included browser readerId");
expect(
  "POS draft",
  posDraft.json?.draft?.terminalLocationId === undefined,
  "transient draft included browser terminalLocationId"
);
expect(
  "POS draft",
  ["convex_unconfigured", "staff_auth_required"].includes(posDraft.json?.persistenceReason),
  `expected no-write persistence reason, got ${posDraft.json?.persistenceReason ?? "none"}`
);
expectNoClientSecret("POS draft", posDraft);

for (const issue of paymentDraftProvenanceIssues({ checkoutDraft: checkoutDraft.json, posDraft: posDraft.json })) {
  fail("payment draft provenance", issue);
}

const posReadersUnauthed = await getJson("/api/pos/readers");
expectFailClosed("POS reader registry unauthenticated", posReadersUnauthed, 401, "staff_auth_required");
expectNoStore("POS reader registry unauthenticated", posReadersUnauthed);
expectAuthorizationVary("POS reader registry unauthenticated", posReadersUnauthed);

const checkoutPayment = await postJson("/api/payments/stripe-checkout", {
  orderRef: "SKY2607-SMOKE1",
  idempotencyKey: "smoke_checkout_no_write",
  amountCents: 1
});

expectFailClosedCode("Stripe Checkout execution", checkoutPayment, 503, [
  "convex_unconfigured",
  "payment_service_unavailable"
]);
expectNoStore("Stripe Checkout execution", checkoutPayment);

const checkoutStatus = await postJson("/api/payments/stripe-checkout/status", {
  checkoutSessionId: "cs_test_smoke1234567890"
});
expect(
  "Stripe Checkout status",
  [404, 502, 503].includes(checkoutStatus.status),
  `expected HTTP 404, 502, or 503, got ${checkoutStatus.status}`
);
expect(
  "Stripe Checkout status",
  ["checkout_not_found", "convex_unconfigured", "payment_service_unavailable"].includes(checkoutStatus.json?.code),
  `unexpected code ${checkoutStatus.json?.code ?? "none"}`
);
expectNoClientSecret("Stripe Checkout status", checkoutStatus);
expectNoStore("Stripe Checkout status", checkoutStatus);

const terminalUnauthed = await postJson("/api/payments/stripe-terminal", {
  saleRef: "SALE260704-SMOKE1",
  idempotencyKey: "smoke_terminal_no_auth",
  amountCents: 1,
  readerId: "tmr_browser_supplied"
});

expectFailClosed("Stripe Terminal unauthenticated", terminalUnauthed, 401, "staff_auth_required");
expectNoStore("Stripe Terminal unauthenticated", terminalUnauthed);
expectAuthorizationVary("Stripe Terminal unauthenticated", terminalUnauthed);

const terminalAuthed = await postJson(
  "/api/payments/stripe-terminal",
  {
    saleRef: "SALE260704-SMOKE1",
    idempotencyKey: "smoke_terminal_fake_auth",
    amountCents: 1,
    currency: "eur",
    readerId: "tmr_browser_supplied"
  },
  { authorization: `Bearer ${fakeStaffToken}` }
);

expect(
  "Stripe Terminal fake auth",
  terminalAuthed.status === 503,
  `expected HTTP 503, got ${terminalAuthed.status}`
);
expect(
  "Stripe Terminal fake auth",
  ["convex_unconfigured", "pos_terminal_acceptance_required", "payment_service_unavailable"].includes(
    terminalAuthed.json?.code
  ),
  `expected convex_unconfigured, pos_terminal_acceptance_required, or payment_service_unavailable, got ${terminalAuthed.json?.code ?? "none"}`
);
expectNoClientSecret("Stripe Terminal fake auth", terminalAuthed);
expectNoStore("Stripe Terminal fake auth", terminalAuthed);
expectAuthorizationVary("Stripe Terminal fake auth", terminalAuthed);

const terminalProcess = await postJson(
  "/api/payments/stripe-terminal/process",
  {
    saleRef: "SALE260704-SMOKE1",
    idempotencyKey: "smoke_terminal_process_fake_auth",
    amountCents: 1,
    currency: "eur",
    readerId: "tmr_browser_supplied"
  },
  { authorization: `Bearer ${fakeStaffToken}` }
);

expect(
  "Stripe Terminal process fake auth",
  terminalProcess.status === 503,
  `expected HTTP 503, got ${terminalProcess.status}`
);
expect(
  "Stripe Terminal process fake auth",
  ["convex_unconfigured", "pos_terminal_acceptance_required", "payment_service_unavailable"].includes(
    terminalProcess.json?.code
  ),
  `expected convex_unconfigured, pos_terminal_acceptance_required, or payment_service_unavailable, got ${terminalProcess.json?.code ?? "none"}`
);
expectNoClientSecret("Stripe Terminal process fake auth", terminalProcess);
expectNoStore("Stripe Terminal process fake auth", terminalProcess);
expectAuthorizationVary("Stripe Terminal process fake auth", terminalProcess);

if (failures.length > 0) {
  console.error(`Payment API smoke failed for ${baseUrl.origin}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Payment API smoke passed for ${baseUrl.origin}.`);
console.log(`- Checkout total: ${checkoutDraft.json.draft.totalCents} cents`);
console.log(`- POS total: ${posDraft.json.draft.totalCents} cents`);
console.log("- Checkout/POS catalog-priced lines include code-owned catalog provenance metadata.");
console.log("- Stripe execution routes fail closed without real Convex/Stripe dashboard wiring and POS Terminal acceptance.");
console.log("- Checkout return status derives the order from a stored Stripe Session capability and is non-cacheable.");
console.log("- Payment and staff-gated POS responses are marked no-store, with Authorization variance on staff routes.");
