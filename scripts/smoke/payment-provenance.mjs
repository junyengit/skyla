const expectedCatalogMetadata = {
  catalogVersion: "skyla-payments-catalog-2026-07-20",
  catalogSource: "@skyla/payments",
  catalogAuthority: "code-owned"
};

const expectedCatalogHashes = {
  general: "fnv1a32:f1249f9b:83",
  matcha: "fnv1a32:ef7db060:95",
  b1: "fnv1a32:b86957e2:102"
};

const catalogHashPattern = /^fnv1a32:[a-f0-9]{8}:\d+$/;

export function paymentDraftProvenanceIssues({ checkoutDraft, posDraft }) {
  return [
    ...checkoutDraftProvenanceIssues(checkoutDraft?.draft?.lines),
    ...posDraftProvenanceIssues(posDraft?.draft?.lines)
  ];
}

export function checkoutDraftProvenanceIssues(lines) {
  const issues = [];
  const checkoutLines = Array.isArray(lines) ? lines : [];

  issues.push(
    ...catalogLineIssues("checkout adult ticket line", checkoutLines[0], {
      kind: "ticket",
      productKey: "general",
      quantity: 2,
      unitAmountCents: 2000,
      lineTotalCents: 4000
    }),
    ...catalogLineIssues("checkout child ticket line", checkoutLines[1], {
      kind: "ticket",
      productKey: "general",
      quantity: 1,
      unitAmountCents: 1000,
      lineTotalCents: 1000,
      childDiscountRate: 0.5
    }),
    ...catalogLineIssues("checkout add-on line", checkoutLines[2], {
      kind: "addon",
      productKey: "matcha",
      quantity: 1,
      unitAmountCents: 800,
      lineTotalCents: 800
    })
  );

  return issues;
}

export function posDraftProvenanceIssues(lines) {
  const issues = [];
  const posLines = Array.isArray(lines) ? lines : [];

  issues.push(
    ...catalogLineIssues("POS ticket line", posLines[0], {
      kind: "ticket",
      productKey: "general",
      quantity: 2,
      unitAmountCents: 2000,
      lineTotalCents: 4000
    }),
    ...catalogLineIssues("POS cafe line", posLines[1], {
      kind: "cafe",
      productKey: "b1",
      quantity: 3,
      unitAmountCents: 600,
      lineTotalCents: 1800
    }),
    ...customLineIssues("POS custom line", posLines[2], {
      reason: "Manager approved",
      quantity: 1,
      unitAmountCents: 500,
      lineTotalCents: 500
    })
  );

  return issues;
}

function catalogLineIssues(label, line, expected) {
  const issues = [];

  if (!line || typeof line !== "object") {
    return [`${label}: missing line`];
  }
  if (line.kind !== expected.kind) {
    issues.push(`${label}: expected kind ${expected.kind}, got ${line.kind ?? "none"}`);
  }
  if (line.productKey !== expected.productKey) {
    issues.push(`${label}: expected productKey ${expected.productKey}, got ${line.productKey ?? "none"}`);
  }
  for (const key of ["quantity", "unitAmountCents", "lineTotalCents"]) {
    if (line[key] !== expected[key]) {
      issues.push(`${label}: expected ${key} ${expected[key]}, got ${line[key] ?? "none"}`);
    }
  }

  const metadata = line.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    issues.push(`${label}: missing catalog metadata`);
    return issues;
  }

  for (const [key, value] of Object.entries(expectedCatalogMetadata)) {
    if (metadata[key] !== value) {
      issues.push(`${label}: expected metadata.${key} ${value}, got ${metadata[key] ?? "none"}`);
    }
  }
  if (!catalogHashPattern.test(String(metadata.catalogContentHash ?? ""))) {
    issues.push(`${label}: metadata.catalogContentHash is not a stable fnv1a32 hash`);
  }
  if (metadata.catalogContentHash !== expectedCatalogHashes[expected.productKey]) {
    issues.push(
      `${label}: expected catalogContentHash ${expectedCatalogHashes[expected.productKey]}, got ${metadata.catalogContentHash ?? "none"}`
    );
  }
  if (Object.values(metadata).includes("browser-spoof")) {
    issues.push(`${label}: browser-supplied catalog metadata was reflected`);
  }
  if (expected.childDiscountRate !== undefined && metadata.childDiscountRate !== expected.childDiscountRate) {
    issues.push(`${label}: expected childDiscountRate ${expected.childDiscountRate}, got ${metadata.childDiscountRate ?? "none"}`);
  }

  return issues;
}

function customLineIssues(label, line, expected) {
  if (!line || typeof line !== "object") {
    return [`${label}: missing line`];
  }

  const issues = [];
  if (line.kind !== "custom") {
    issues.push(`${label}: expected kind custom, got ${line.kind ?? "none"}`);
  }
  for (const key of ["quantity", "unitAmountCents", "lineTotalCents"]) {
    if (line[key] !== expected[key]) {
      issues.push(`${label}: expected ${key} ${expected[key]}, got ${line[key] ?? "none"}`);
    }
  }

  const metadata = line.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [...issues, `${label}: missing custom reason metadata`];
  }

  if (metadata.reason !== expected.reason) {
    issues.push(`${label}: expected reason metadata ${expected.reason}, got ${metadata.reason ?? "none"}`);
  }
  for (const key of Object.keys(metadata)) {
    if (key.startsWith("catalog")) {
      issues.push(`${label}: custom line should not include ${key}`);
    }
  }
  if (Object.values(metadata).includes("browser-spoof")) {
    issues.push(`${label}: browser-supplied custom metadata was reflected`);
  }
  return issues;
}
