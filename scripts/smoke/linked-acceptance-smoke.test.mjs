import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/smoke/linked-acceptance-smoke.mjs");
const staffToken = "staff.jwt.token";

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorized: request.headers.authorization === `Bearer ${staffToken}`
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

function linkedReadiness({ registryConfigured = true } = {}) {
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
      acceptanceEnabled: false,
      readerProcessingReady: false
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

async function runPreflight(baseUrl) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ACCEPTANCE_BASE_URL: baseUrl,
      SKYLA_ACCEPTANCE_MODE: "linked-test",
      SKYLA_ACCEPTANCE_STRIPE_MODE: "test",
      SKYLA_ACCEPTANCE_NO_REAL_CARDS: "1",
      SKYLA_STAFF_TEST_TOKEN: staffToken,
      SKYLA_ACCEPTANCE_PREFLIGHT: "1"
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
