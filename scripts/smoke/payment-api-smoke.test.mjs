import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/smoke/payment-api-smoke.mjs");

const catalogMetadata = {
  catalogVersion: "skyla-payments-catalog-2026-07-20",
  catalogSource: "@skyla/payments",
  catalogAuthority: "code-owned",
  catalogContentHash: "fnv1a32:f1249f9b:83"
};

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorized: request.headers.authorization === "Bearer smoke.fake.staff.token",
        body: body ? JSON.parse(body) : undefined
      });
      handler(request, response);
    });
  });

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    return await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requests
    });
  } finally {
    await new Promise((resolveClose) => {
      server.close(resolveClose);
    });
  }
}

function json(response, body, status = 200, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function noStoreHeaders({ staff = false } = {}) {
  return staff ? { "cache-control": "no-store", vary: "Authorization" } : { "cache-control": "no-store" };
}

function handler({ omitProvenance = false, wrongHash = false } = {}) {
  return (request, response) => {
    if (request.method === "GET" && request.url === "/api/pos/readers") {
      json(response, { code: "staff_auth_required" }, 401, noStoreHeaders({ staff: true }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/order-drafts/checkout") {
      json(response, {
        persisted: false,
        persistenceReason: "convex_unconfigured",
        draft: {
          totalCents: 5800,
          lines: [
            {
              kind: "ticket",
              productKey: "general",
              quantity: 2,
              unitAmountCents: 2000,
              lineTotalCents: 4000,
              metadata: omitProvenance ? undefined : { ...catalogMetadata, catalogContentHash: wrongHash ? "fnv1a32:00000000:83" : catalogMetadata.catalogContentHash }
            },
            {
              kind: "ticket",
              productKey: "general",
              quantity: 1,
              unitAmountCents: 1000,
              lineTotalCents: 1000,
              metadata: omitProvenance
                ? undefined
                : {
                    ...catalogMetadata,
                    catalogContentHash: wrongHash ? "fnv1a32:00000000:83" : catalogMetadata.catalogContentHash,
                    childDiscountRate: 0.5
                  }
            },
            {
              kind: "addon",
              productKey: "matcha",
              quantity: 1,
              unitAmountCents: 800,
              lineTotalCents: 800,
              metadata: omitProvenance
                ? undefined
                : { ...catalogMetadata, catalogContentHash: wrongHash ? "fnv1a32:00000000:95" : "fnv1a32:ef7db060:95" }
            }
          ]
        }
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/order-drafts/pos") {
      json(response, {
        persisted: false,
        persistenceReason: "convex_unconfigured",
        draft: {
          totalCents: 6300,
          lines: [
            {
              kind: "ticket",
              productKey: "general",
              quantity: 2,
              unitAmountCents: 2000,
              lineTotalCents: 4000,
              metadata: omitProvenance
                ? undefined
                : { ...catalogMetadata, catalogContentHash: wrongHash ? "fnv1a32:00000000:83" : "fnv1a32:f1249f9b:83" }
            },
            {
              kind: "cafe",
              productKey: "b1",
              quantity: 3,
              unitAmountCents: 600,
              lineTotalCents: 1800,
              metadata: omitProvenance
                ? undefined
                : { ...catalogMetadata, catalogContentHash: wrongHash ? "fnv1a32:00000000:102" : "fnv1a32:b86957e2:102" }
            },
            {
              kind: "custom",
              quantity: 1,
              unitAmountCents: 500,
              lineTotalCents: 500,
              metadata: omitProvenance ? { catalogAuthority: "browser-spoof" } : { reason: "Manager approved" }
            }
          ]
        }
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/payments/stripe-terminal") {
      const authorized = request.headers.authorization === "Bearer smoke.fake.staff.token";
      json(
        response,
        { code: authorized ? "convex_unconfigured" : "staff_auth_required" },
        authorized ? 503 : 401,
        noStoreHeaders({ staff: true })
      );
      return;
    }

    if (request.method === "POST" && request.url === "/api/payments/stripe-terminal/process") {
      json(response, { code: "convex_unconfigured" }, 503, noStoreHeaders({ staff: true }));
      return;
    }

    if (request.method === "POST" && request.url === "/api/payments/stripe-checkout") {
      json(response, { code: "convex_unconfigured" }, 503, noStoreHeaders());
      return;
    }

    if (request.method === "POST" && request.url === "/api/payments/stripe-checkout/status") {
      json(response, { code: "convex_unconfigured" }, 503, noStoreHeaders());
      return;
    }

    json(response, { error: "not found" }, 404);
  };
}

async function runSmoke(baseUrl) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PAYMENT_SMOKE_BASE_URL: baseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const status = await new Promise((resolveClose) => {
    child.on("close", resolveClose);
  });

  return { status, stdout, stderr };
}

describe("payment API smoke", () => {
  it("checks no-write totals, fail-closed Stripe routes, and catalog provenance", async () => {
    await withServer(handler(), async ({ baseUrl, requests }) => {
      const result = await runSmoke(baseUrl);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Checkout/POS catalog-priced lines include code-owned catalog provenance metadata");
      expect(result.stdout).toContain("Payment and staff-gated POS responses are marked no-store");
      expect(requests.find((request) => request.url === "/api/order-drafts/checkout")?.body).toMatchObject({
        totalCents: 1,
        catalogVersion: "browser-spoof"
      });
      expect(requests.find((request) => request.url === "/api/order-drafts/pos")?.body.lines[0]).toMatchObject({
        unitAmountCents: 1,
        metadata: { catalogVersion: "browser-spoof" }
      });
    });
  }, 10_000);

  it("fails when draft line provenance is missing or browser metadata is reflected", async () => {
    await withServer(handler({ omitProvenance: true }), async ({ baseUrl }) => {
      const result = await runSmoke(baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("payment draft provenance");
      expect(result.stderr).toContain("checkout adult ticket line: missing catalog metadata");
      expect(result.stderr).toContain("POS custom line: custom line should not include catalogAuthority");
    });
  }, 10_000);

  it("fails when provenance hashes do not match the canonical product", async () => {
    await withServer(handler({ wrongHash: true }), async ({ baseUrl }) => {
      const result = await runSmoke(baseUrl);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("expected catalogContentHash fnv1a32:f1249f9b:83");
      expect(result.stderr).toContain("expected catalogContentHash fnv1a32:b86957e2:102");
    });
  }, 10_000);
});
