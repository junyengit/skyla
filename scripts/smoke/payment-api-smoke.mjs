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

const checkoutDraft = await postJson("/api/order-drafts/checkout", {
  packageKey: "general",
  adults: 2,
  children: 1,
  addons: { matcha: 1 },
  totalCents: 1,
  amountCents: 1
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
    { kind: "ticket", packageKey: "drink", quantity: 2, unitAmountCents: 1 },
    { kind: "cafe", itemKey: "b1", quantity: 3, priceCents: 1 },
    { kind: "custom", name: "Service recovery", amountCents: 500, quantity: 1, reason: "Manager approved" }
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

const checkoutPayment = await postJson("/api/payments/stripe-checkout", {
  orderRef: "SKY2607-SMOKE1",
  idempotencyKey: "smoke_checkout_no_write",
  amountCents: 1
});

expectFailClosed("Stripe Checkout execution", checkoutPayment, 503, "convex_unconfigured");

const terminalUnauthed = await postJson("/api/payments/stripe-terminal", {
  saleRef: "SALE260704-SMOKE1",
  idempotencyKey: "smoke_terminal_no_auth",
  amountCents: 1,
  readerId: "tmr_browser_supplied"
});

expectFailClosed("Stripe Terminal unauthenticated", terminalUnauthed, 401, "staff_auth_required");

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

expectFailClosed("Stripe Terminal fake auth", terminalAuthed, 503, "convex_unconfigured");

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

expectFailClosed("Stripe Terminal process fake auth", terminalProcess, 503, "convex_unconfigured");

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
console.log("- Stripe execution routes fail closed without real Convex/Stripe dashboard wiring.");
