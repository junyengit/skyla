import { afterEach, describe, expect, it, vi } from "vitest";

import { publicGateway } from "./http";

declare const process: { env: Record<string, string | undefined> };

const gatewaySecret = "convex-launch-gate-test-secret-32-chars";
const handler = (publicGateway as unknown as {
  _handler: (ctx: unknown, request: Request) => Promise<Response>;
})._handler;

afterEach(() => {
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
});

function request(operation: "checkout-draft" | "stripe-checkout") {
  return new Request("https://example.convex.site/public-gateway", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gatewaySecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operation,
      rateLimitKey: "a".repeat(64),
      input: operation === "checkout-draft"
        ? { packageKey: "general", adults: 1, idempotencyKey: "checkout_prelaunch_0001" }
        : {
            orderRef: "SKY2608-PRELAUNCH",
            idempotencyKey: "stripe_prelaunch_0001",
            successUrl: "https://skydeckla.com/checkout?stripe=success",
            cancelUrl: "https://skydeckla.com/checkout?stripe=cancel"
          }
    })
  });
}

describe("Convex public gateway pre-launch gate", () => {
  it.each(["checkout-draft", "stripe-checkout"] as const)(
    "rejects %s before dispatching an internal operation",
    async (operation) => {
      process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
      const ctx = { runMutation: vi.fn(), runAction: vi.fn() };
      const response = await handler(ctx, request(operation));

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: "ticket_sales_not_live",
        error: "Sky LA is not open yet. Ticket sales are not live."
      });
      expect(ctx.runMutation).not.toHaveBeenCalled();
      expect(ctx.runAction).not.toHaveBeenCalled();
    }
  );
});
