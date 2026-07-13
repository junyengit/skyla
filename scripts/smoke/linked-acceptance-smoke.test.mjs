import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/smoke/linked-acceptance-smoke.mjs");
const staffToken = "staff.jwt.token";
const catalogMetadata = {
  catalogVersion: "skyla-payments-catalog-2026-07-05",
  catalogSource: "@skyla/payments",
  catalogAuthority: "code-owned"
};

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorized: request.headers.authorization === `Bearer ${staffToken}`,
      body: undefined
    });
    handler(request, response);
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

function json(response, body, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function linkedReadiness({ registryConfigured = true, terminalReady = false } = {}) {
  return {
    staff: {
      emailLower: "pos@example.com",
      role: "pos"
    },
    stripe: {
      mode: "test",
      secretConfigured: true,
      paymentReturnOriginsConfigured: true,
      webhookSecretConfigured: true,
      checkoutReady: true
    },
    terminal: {
      readerRegistryConfigured: registryConfigured,
      readerRegistryValid: registryConfigured,
      readerCount: registryConfigured ? 1 : 0,
      acceptanceEnabled: terminalReady,
      readerProcessingReady: terminalReady
    }
  };
}

function linkedHandler(options = {}) {
  return (request, response) => {
    const authorized = request.headers.authorization === `Bearer ${staffToken}`;

    if (request.method !== "GET") {
      json(response, { error: "preflight made a write request" }, 500);
      return;
    }

    if (request.url === "/api/admin/acceptance-readiness") {
      if (!authorized) {
        json(response, { code: "staff_auth_required" }, 401);
        return;
      }
      json(response, linkedReadiness(options));
      return;
    }

    if (request.url === "/api/pos/readers") {
      if (!authorized) {
        json(response, { code: "staff_auth_required" }, 401);
        return;
      }
      json(response, {
        staff: {
          emailLower: "pos@example.com",
          role: "pos"
        },
        readers: options.registryConfigured === false
          ? []
          : [
              {
                label: "Front Desk",
                readerId: "tmr_frontdesk",
                terminalLocationId: "tml_lobby"
              }
            ]
      });
      return;
    }

    json(response, { error: "not found" }, 404);
  };
}

async function runAcceptance(baseUrl, extraEnv = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ACCEPTANCE_BASE_URL: baseUrl,
      SKYLA_ACCEPTANCE_MODE: "linked-test",
      SKYLA_ACCEPTANCE_STRIPE_MODE: "test",
      SKYLA_ACCEPTANCE_NO_REAL_CARDS: "1",
      SKYLA_STAFF_TEST_TOKEN: staffToken,
      ...extraEnv
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

  return {
    status,
    stdout,
    stderr
  };
}

async function runPreflight(baseUrl) {
  return runAcceptance(baseUrl, { SKYLA_ACCEPTANCE_PREFLIGHT: "1" });
}

async function readJsonBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
  }
  return text ? JSON.parse(text) : {};
}

describe("linked acceptance preflight", () => {
  it("checks linked readiness and POS readers without calling write APIs", async () => {
    await withServer(linkedHandler({ registryConfigured: true }), async ({ baseUrl, requests }) => {
      const result = await runPreflight(baseUrl);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Linked acceptance preflight passed");
      expect(result.stdout).toContain("No write APIs were called");
      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "GET /api/admin/acceptance-readiness",
        "GET /api/admin/acceptance-readiness",
        "GET /api/pos/readers",
        "GET /api/pos/readers"
      ]);
    });
  }, 10_000);

  it("skips the authenticated reader listing when readiness says no registry is configured", async () => {
    await withServer(linkedHandler({ registryConfigured: false }), async ({ baseUrl, requests }) => {
      const result = await runPreflight(baseUrl);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("POS reader registry is not configured");
      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(
        requests.filter((request) => request.url === "/api/pos/readers" && request.authorized)
      ).toHaveLength(0);
    });
  }, 10_000);
});

describe("linked acceptance write flow", () => {
  it("reuses the stored draft idempotency keys for optional Stripe legs", async () => {
    const requests = [];
    const memberIdempotencyKeys = new Set();
    const server = createServer(async (request, response) => {
      const record = {
        method: request.method,
        url: request.url,
        authorized: request.headers.authorization === `Bearer ${staffToken}`,
        body: request.method === "POST" ? await readJsonBody(request) : undefined
      };
      requests.push(record);

      if (request.url === "/api/admin/acceptance-readiness") {
        if (!record.authorized) {
          json(response, { code: "staff_auth_required" }, 401);
          return;
        }
        json(response, linkedReadiness({ terminalReady: true }));
        return;
      }

      if (request.url === "/api/pos/readers") {
        if (!record.authorized) {
          json(response, { code: "staff_auth_required" }, 401);
          return;
        }
        json(response, {
          readers: [
            {
              label: "Front Desk",
              readerId: "tmr_frontdesk",
              terminalLocationId: "tml_lobby"
            }
          ]
        });
        return;
      }

      if (request.url === "/api/order-drafts/checkout") {
        json(response, {
          persisted: true,
          orderRef: "ORD260706-ACCEPT",
          draft: {
            totalCents: 8505,
            visitDate: record.body.visitDate,
            entryTime: record.body.entryTime,
            lines: [
              {
                kind: "ticket",
                productKey: "general",
                quantity: 2,
                unitAmountCents: 2900,
                lineTotalCents: 5800,
                metadata: { ...catalogMetadata, catalogContentHash: "fnv1a32:1f58cd3b:92" }
              },
              {
                kind: "ticket",
                productKey: "general",
                quantity: 1,
                unitAmountCents: 1500,
                lineTotalCents: 1500,
                metadata: { ...catalogMetadata, catalogContentHash: "fnv1a32:1f58cd3b:92", childDiscountRate: 0.5 }
              },
              {
                kind: "addon",
                productKey: "matcha",
                quantity: 1,
                unitAmountCents: 800,
                lineTotalCents: 800,
                metadata: { ...catalogMetadata, catalogContentHash: "fnv1a32:ef7db060:95" }
              }
            ]
          }
        });
        return;
      }

      if (request.url === "/api/members/applications") {
        const replayed = memberIdempotencyKeys.has(record.body.idempotencyKey);
        memberIdempotencyKeys.add(record.body.idempotencyKey);
        json(
          response,
          {
            member: {
              status: "pending",
              emailLower: record.body.email,
              replayed
            }
          },
          replayed ? 200 : 201
        );
        return;
      }

      if (request.url === "/api/experiences/inquiries") {
        json(
          response,
          {
            inquiry: {
              status: "pending",
              emailLower: record.body.email
            }
          },
          201
        );
        return;
      }

      if (request.url === "/api/order-drafts/pos") {
        json(response, {
          persisted: true,
          saleRef: "POS260706-ACCEPT",
          draft: {
            totalCents: 9700,
            terminalLocationId: "tml_lobby",
            lines: [
              {
                kind: "ticket",
                productKey: "drink",
                quantity: 2,
                unitAmountCents: 3700,
                lineTotalCents: 7400,
                metadata: { ...catalogMetadata, catalogContentHash: "fnv1a32:ee2426f7:85" }
              },
              {
                kind: "cafe",
                productKey: "b1",
                quantity: 3,
                unitAmountCents: 600,
                lineTotalCents: 1800,
                metadata: { ...catalogMetadata, catalogContentHash: "fnv1a32:b86957e2:102" }
              },
              {
                kind: "custom",
                quantity: 1,
                unitAmountCents: 500,
                lineTotalCents: 500,
                metadata: { reason: "Manager approved" }
              }
            ]
          }
        });
        return;
      }

      if (request.url === "/api/payments/stripe-terminal") {
        json(response, {
          saleRef: record.body.saleRef,
          provider: "terminal",
          paymentIntentId: "pi_terminal_acceptance",
          amountCents: 9700,
          currency: "usd",
          status: "requires_payment"
        });
        return;
      }

      if (request.url === "/api/payments/stripe-terminal/process") {
        json(response, {
          saleRef: record.body.saleRef,
          provider: "terminal",
          paymentIntentId: "pi_terminal_acceptance",
          readerId: "tmr_frontdesk",
          amountCents: 9700,
          currency: "usd",
          status: "processing",
          readerStatus: "online",
          readerActionStatus: "in_progress"
        });
        return;
      }

      if (request.url === "/api/payments/stripe-checkout") {
        json(response, {
          orderRef: record.body.orderRef,
          provider: "stripe",
          checkoutSessionId: "cs_test_acceptance",
          url: "https://checkout.stripe.com/c/pay/cs_test_acceptance",
          amountCents: 8505,
          currency: "usd"
        });
        return;
      }

      json(response, { error: "not found" }, 404);
    });

    await new Promise((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });

    try {
      const address = server.address();
      const result = await runAcceptance(`http://127.0.0.1:${address.port}`, {
        SKYLA_ACCEPTANCE_STRIPE_CHECKOUT: "1",
        SKYLA_ACCEPTANCE_TERMINAL_READER: "1"
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");

      const checkoutDraft = requests.find((request) => request.url === "/api/order-drafts/checkout");
      const inquiry = requests.find((request) => request.url === "/api/experiences/inquiries");
      const stripeCheckout = requests.find((request) => request.url === "/api/payments/stripe-checkout");
      const posDraft = requests.find((request) => request.url === "/api/order-drafts/pos");
      const terminalIntent = requests.find((request) => request.url === "/api/payments/stripe-terminal");
      const terminalProcess = requests.find((request) => request.url === "/api/payments/stripe-terminal/process");

      expect(stripeCheckout.body.idempotencyKey).toBe(checkoutDraft.body.idempotencyKey);
      expect(checkoutDraft.body.visitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(`${checkoutDraft.body.visitDate}T12:00:00Z`)).toBeGreaterThan(Date.now());
      expect(checkoutDraft.body.entryTime).toBe("18:00");
      expect(inquiry.body.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(`${inquiry.body.eventDate}T12:00:00Z`)).toBeGreaterThan(Date.now());
      expect(terminalIntent.body.idempotencyKey).toBe(posDraft.body.idempotencyKey);
      expect(terminalProcess.body.idempotencyKey).toBe(posDraft.body.idempotencyKey);
      expect(terminalIntent.body.idempotencyKey).not.toMatch(/^acc_terminal_/);
      expect(stripeCheckout.body.idempotencyKey).not.toMatch(/^acc_stripe_checkout_/);
      expect(checkoutDraft.body.catalogVersion).toBe("browser-spoof");
      expect(posDraft.body.lines[0].metadata.catalogVersion).toBe("browser-spoof");
      expect(posDraft.body.lines[2].metadata.catalogAuthority).toBe("browser-spoof");
    } finally {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
      });
    }
  }, 10_000);
});
