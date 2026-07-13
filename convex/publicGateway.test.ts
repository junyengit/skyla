import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { submitInquiry } from "./inquiries";
import { submitApplication } from "./memberApplications";
import { createCheckoutOrderDraft, createPosSaleDraft } from "./orderDrafts";
import { createStripeCheckoutSession, createStripeTerminalPaymentIntent } from "./payments";
import {
  cleanupExpiredPublicGatewayRateLimits,
  consumePublicGatewayRateLimit,
  nextPublicGatewayRateLimit,
  publicGatewayGlobalRateLimitPolicies,
  publicGatewayRateLimitIdentity,
  publicGatewayRateLimitPolicies,
  publicGatewaySecretMatches,
  validPublicGatewaySecret
} from "./lib/publicGateway";

describe("public gateway security boundary", () => {
  it("removes anonymous persistence and Checkout actions from the public Convex API", () => {
    expect(registrationFlags(submitInquiry)).toMatchObject({ isInternal: true, isPublic: undefined });
    expect(registrationFlags(submitApplication)).toMatchObject({ isInternal: true, isPublic: undefined });
    expect(registrationFlags(createCheckoutOrderDraft)).toMatchObject({ isInternal: true, isPublic: undefined });
    expect(registrationFlags(createStripeCheckoutSession)).toMatchObject({ isInternal: true, isPublic: undefined });

    expect(registrationFlags(createPosSaleDraft)).toMatchObject({ isInternal: undefined, isPublic: true });
    expect(registrationFlags(createStripeTerminalPaymentIntent)).toMatchObject({ isInternal: undefined, isPublic: true });
  });

  it("compares only well-shaped gateway secrets", async () => {
    const secret = "gateway-secret-value-that-is-long-enough";
    expect(validPublicGatewaySecret(secret)).toBe(true);
    expect(validPublicGatewaySecret("short")).toBe(false);
    expect(validPublicGatewaySecret(`${secret} with-space`)).toBe(false);
    await expect(publicGatewaySecretMatches(secret, secret)).resolves.toBe(true);
    await expect(publicGatewaySecretMatches(secret, `${secret}-wrong`)).resolves.toBe(false);
    await expect(publicGatewaySecretMatches(secret, undefined)).resolves.toBe(false);
  });

  it("resets expired windows and reports a stable retry time at the limit", () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const first = nextPublicGatewayRateLimit(null, 10_000, policy);
    const second = nextPublicGatewayRateLimit(first, 20_000, policy);
    const blocked = nextPublicGatewayRateLimit(second, 30_000, policy);
    const reset = nextPublicGatewayRateLimit(second, 70_000, policy);

    expect(first).toMatchObject({ allowed: true, count: 1, windowExpiresAt: 70_000 });
    expect(second).toMatchObject({ allowed: true, count: 2, windowExpiresAt: 70_000 });
    expect(blocked).toMatchObject({ allowed: false, count: 2, retryAfterSeconds: 40 });
    expect(reset).toMatchObject({ allowed: true, count: 1, windowStartedAt: 70_000 });
  });

  it("persists and enforces the authoritative Convex quota before another write can proceed", async () => {
    const { db, rows } = createRateDb();
    const keyHash = "a".repeat(64);
    const policy = publicGatewayRateLimitPolicies["member-application"];

    for (let count = 0; count < policy.limit; count += 1) {
      await consumePublicGatewayRateLimit({ db } as never, "member-application", keyHash, 1_000);
    }
    expect(rows.get(publicGatewayRateLimitIdentity(keyHash))?.count).toBe(policy.limit);
    expect(rows.get("global")?.count).toBe(policy.limit);
    await expect(
      consumePublicGatewayRateLimit({ db } as never, "member-application", keyHash, 1_001)
    ).rejects.toBeInstanceOf(ConvexError);
    expect(rows.get(publicGatewayRateLimitIdentity(keyHash))?.count).toBe(policy.limit);
    expect(rows.get("global")?.count).toBe(policy.limit);
  });

  it("applies a global ceiling even when an attacker rotates client identities", async () => {
    const { db, rows } = createRateDb();
    const globalPolicy = publicGatewayGlobalRateLimitPolicies["member-application"];

    for (let count = 0; count < globalPolicy.limit; count += 1) {
      const keyHash = count.toString(16).padStart(3, "0") + "a".repeat(61);
      await consumePublicGatewayRateLimit({ db } as never, "member-application", keyHash, 1_000);
    }
    expect(rows.get("global")?.count).toBe(globalPolicy.limit);
    expect(rows.size).toBe(globalPolicy.limit + 1);
    await expect(
      consumePublicGatewayRateLimit({ db } as never, "member-application", "fff" + "a".repeat(61), 1_001)
    ).rejects.toBeInstanceOf(ConvexError);
  });

  it("keeps the full HMAC identity and deletes expired rows in bounded batches", async () => {
    const first = "abc" + "1".repeat(61);
    const second = "abc" + "2".repeat(61);
    expect(publicGatewayRateLimitIdentity(first)).toBe(first);
    expect(publicGatewayRateLimitIdentity(second)).toBe(second);
    expect(publicGatewayRateLimitIdentity(first)).not.toBe(publicGatewayRateLimitIdentity(second));

    const { db, rows } = createRateDb([
      rateRow("expired-1", first, 500),
      rateRow("expired-2", second, 700),
      rateRow("active", "def" + "3".repeat(61), 2_000)
    ]);
    await expect(cleanupExpiredPublicGatewayRateLimits({ db } as never, 1_000, 1)).resolves.toEqual({ deleted: 1 });
    expect(rows.size).toBe(2);
    expect([...rows.values()].filter((row) => row.windowExpiresAt < 1_000)).toHaveLength(1);
    expect([...rows.values()].some((row) => row.windowExpiresAt === 2_000)).toBe(true);
  });
});

function registrationFlags(value: unknown) {
  const registered = value as { isInternal?: boolean; isPublic?: boolean };
  return { isInternal: registered.isInternal, isPublic: registered.isPublic };
}

type RateRow = {
  _id: string;
  operation: "member-application";
  keyHash: string;
  count: number;
  windowStartedAt: number;
  windowExpiresAt: number;
  updatedAt: number;
};

function rateRow(id: string, keyHash: string, windowExpiresAt: number): RateRow {
  return {
    _id: id,
    operation: "member-application",
    keyHash,
    count: 1,
    windowStartedAt: 0,
    windowExpiresAt,
    updatedAt: 0
  };
}

function createRateDb(initial: RateRow[] = []) {
  const rows = new Map(initial.map((row) => [row.keyHash, row]));
  const db = {
    query: (table: string) => {
      expect(table).toBe("publicGatewayRateLimits");
      return {
        withIndex: (index: string, select: (query: {
          eq: (field: string, value: string) => unknown;
          lt: (field: string, value: number) => unknown;
        }) => unknown) => {
          let selectedKey = "";
          let expiryCutoff = Number.NEGATIVE_INFINITY;
          const query = {
            eq: (field: string, value: string) => {
              if (field === "keyHash") selectedKey = value;
              return query;
            },
            lt: (field: string, value: number) => {
              if (field === "windowExpiresAt") expiryCutoff = value;
              return query;
            }
          };
          select(query);
          return index === "by_windowExpiresAt"
            ? {
                take: async (limit: number) => [...rows.values()]
                  .filter((row) => row.windowExpiresAt < expiryCutoff)
                  .slice(0, limit)
              }
            : { unique: async () => rows.get(selectedKey) ?? null };
        }
      };
    },
    insert: async (_table: string, value: Omit<RateRow, "_id">) => {
      const row = { _id: `rate_${rows.size + 1}`, ...value };
      rows.set(value.keyHash, row);
      return row._id;
    },
    patch: async (id: string, value: Partial<RateRow>) => {
      const existing = [...rows.values()].find((item) => item._id === id);
      if (existing) rows.set(existing.keyHash, { ...existing, ...value });
    },
    delete: async (id: string) => {
      const existing = [...rows.values()].find((item) => item._id === id);
      if (existing) rows.delete(existing.keyHash);
    }
  };
  return { db, rows };
}
