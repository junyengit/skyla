import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@skyla/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@skyla/config")>();
  return { ...original, siteConfig: { ...original.siteConfig, launched: true } };
});

import { publicGateway } from "./http";

declare const process: { env: Record<string, string | undefined> };

const gatewaySecret = "convex-http-gateway-test-secret-32-chars";
const rateLimitKey = "a".repeat(64);
const handler = (publicGateway as unknown as {
  _handler: (ctx: unknown, request: Request) => Promise<Response>;
})._handler;

afterEach(() => {
  delete process.env.SKYLA_PUBLIC_GATEWAY_SECRET;
});

function request(body: unknown, secret = gatewaySecret) {
  return new Request("https://example.convex.site/public-gateway", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("Convex public gateway HTTP action", () => {
  it("fails closed before dispatch when the Convex secret is absent", async () => {
    const ctx = { runMutation: vi.fn(), runAction: vi.fn() };
    const response = await handler(ctx, request({}));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "public_gateway_unconfigured" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("rejects an invalid shared secret without disclosing either value", async () => {
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    const ctx = { runMutation: vi.fn(), runAction: vi.fn() };
    const response = await handler(ctx, request({}, `${gatewaySecret}-wrong`));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "public_gateway_unauthorized" });
    expect(JSON.stringify(body)).not.toContain(gatewaySecret);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("dispatches a valid request only to the internal persistence function", async () => {
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    const result = { inquiryId: "inquiry_1", status: "pending", replayed: false };
    const ctx = { runMutation: vi.fn().mockResolvedValue(result), runAction: vi.fn() };
    const response = await handler(ctx, request({
      operation: "experience-inquiry",
      rateLimitKey,
      input: {
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        experience: "date-night",
        eventDate: "2026-07-10",
        guestCount: "2",
        idempotencyKey: "inquiry_apply_0001"
      }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
    expect(ctx.runMutation).toHaveBeenCalledOnce();
    expect(ctx.runMutation.mock.calls[0]?.[1]).toMatchObject({
      gatewayRateLimitKey: rateLimitKey,
      email: "jane@example.com",
      idempotencyKey: "inquiry_apply_0001"
    });
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("returns Retry-After when Convex rejects the durable quota", async () => {
    process.env.SKYLA_PUBLIC_GATEWAY_SECRET = gatewaySecret;
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(new ConvexError({ code: "rate_limited", retryAfterSeconds: 42 })),
      runAction: vi.fn()
    };
    const response = await handler(ctx, request({
      operation: "checkout-draft",
      rateLimitKey,
      input: { packageKey: "general", adults: 1, idempotencyKey: "checkout_draft_0001" }
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 42
    });
  });
});
