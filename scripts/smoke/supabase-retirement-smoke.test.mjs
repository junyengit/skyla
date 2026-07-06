import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/smoke/supabase-retirement-smoke.mjs");

const retiredFunctions = [
  "stripe-checkout",
  "stripe-terminal",
  "stripe-webhook",
  "kaskade-payment",
  "kaskade-webhook"
];

const retiredMarkers = {
  "stripe-checkout": "Next.js/Convex checkout flow",
  "stripe-terminal": "Next.js/Convex POS saleRef payment flow",
  "stripe-webhook": "legacy_stripe_webhook_retired",
  "kaskade-payment": "Next.js/Convex payment flow",
  "kaskade-webhook": "legacy Kaskade webhook retired"
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
        headers: request.headers,
        body
      });
      handler(request, response, body);
    });
  });

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    return await run({
      baseUrl: `http://127.0.0.1:${address.port}/functions/v1`,
      requests
    });
  } finally {
    await new Promise((resolveClose) => {
      server.close(resolveClose);
    });
  }
}

function respond(response, status, body = "retired") {
  response.writeHead(status, { "content-type": "text/plain" });
  response.end(body);
}

async function runSmoke(baseUrl, extraEnv = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SUPABASE_FUNCTION_BASE_URL: baseUrl,
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

  return { status, stdout, stderr };
}

describe("supabase retirement smoke", () => {
  it("passes when legacy functions are either retired with 410 or disabled with 404", async () => {
    await withServer((request, response) => {
      const functionName = request.url?.split("/").pop();
      respond(response, functionName === "kaskade-webhook" ? 404 : 410, retiredMarkers[functionName] ?? "retired");
    }, async ({ baseUrl, requests }) => {
      const result = await runSmoke(baseUrl, { SKYLA_SUPABASE_RETIREMENT_ALLOW_DISABLED: "1" });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Supabase retirement smoke passed");
      expect(requests.map((request) => request.url)).toEqual(retiredFunctions.map((name) => `/functions/v1/${name}`));
      expect(requests.every((request) => request.method === "POST")).toBe(true);
      expect(requests.every((request) => request.headers["x-skyla-retirement-probe"] === "1")).toBe(true);
    });
  }, 10_000);

  it("uses a harmless Terminal probe action instead of a real bridge action", async () => {
    await withServer((request, response) => respond(response, 410, retiredMarkers["stripe-terminal"]), async ({ baseUrl, requests }) => {
      const result = await runSmoke(baseUrl, { SUPABASE_RETIREMENT_FUNCTIONS: "stripe-terminal" });

      expect(result.status).toBe(0);
      expect(requests).toHaveLength(1);
      const body = JSON.parse(requests[0].body);
      expect(body.action).toBe("__skyla_retirement_probe__");
      expect(body.action).not.toBe("create-intent");
      expect(body.action).not.toBe("setup-reader");
    });
  }, 10_000);

  it("fails when a function still returns an active or inconclusive response", async () => {
    await withServer((request, response) => {
      if (request.url?.endsWith("/stripe-checkout")) {
        respond(response, 200, "active");
        return;
      }
      if (request.url?.endsWith("/stripe-terminal")) {
        respond(response, 401, "jwt required");
        return;
      }
      const functionName = request.url?.split("/").pop();
      respond(response, 410, retiredMarkers[functionName] ?? "retired");
    }, async ({ baseUrl }) => {
      const result = await runSmoke(baseUrl);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stripe-checkout: 200 failed");
      expect(result.stdout).toContain("stripe-terminal: 401 inconclusive");
      expect(result.stderr).toContain("expected disabled 404 or retired 410");
      expect(result.stderr).toContain("pass SKYLA_SUPABASE_RETIREMENT_ANON_KEY");
    });
  }, 10_000);

  it("treats disabled 404 and markerless 410 as inconclusive until explicitly proven", async () => {
    await withServer((request, response) => {
      if (request.url?.endsWith("/stripe-checkout")) {
        respond(response, 404, "not found");
        return;
      }
      respond(response, 410, "gone");
    }, async ({ baseUrl }) => {
      const result = await runSmoke(baseUrl, { SUPABASE_RETIREMENT_FUNCTIONS: "stripe-checkout,stripe-terminal" });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("stripe-checkout: 404 inconclusive");
      expect(result.stdout).toContain("stripe-terminal: 410 inconclusive");
      expect(result.stderr).toContain("SKYLA_SUPABASE_RETIREMENT_ALLOW_DISABLED=1");
      expect(result.stderr).toContain("without the expected retired repo marker");
    });
  }, 10_000);
});
