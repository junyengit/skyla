import { ConvexError } from "convex/values";

import type { MutationCtx } from "../_generated/server";

export type PublicGatewayOperation =
  | "experience-inquiry"
  | "member-application"
  | "checkout-draft"
  | "stripe-checkout";

export type PublicGatewayRateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type StoredRateLimit = {
  count: number;
  windowStartedAt: number;
  windowExpiresAt: number;
};

export const publicGatewayRateLimitPolicies: Record<PublicGatewayOperation, PublicGatewayRateLimitPolicy> = {
  "experience-inquiry": { limit: 5, windowMs: 60 * 60 * 1000 },
  "member-application": { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  "checkout-draft": { limit: 20, windowMs: 15 * 60 * 1000 },
  "stripe-checkout": { limit: 10, windowMs: 15 * 60 * 1000 }
};

export const publicGatewayGlobalRateLimitPolicies: Record<PublicGatewayOperation, PublicGatewayRateLimitPolicy> = {
  "experience-inquiry": { limit: 300, windowMs: 60 * 60 * 1000 },
  "member-application": { limit: 100, windowMs: 24 * 60 * 60 * 1000 },
  "checkout-draft": { limit: 2_000, windowMs: 15 * 60 * 1000 },
  "stripe-checkout": { limit: 500, windowMs: 15 * 60 * 1000 }
};

const globalRateLimitKey = "global";

export function validPublicGatewaySecret(secret: string | undefined) {
  return Boolean(secret && secret.length >= 32 && secret.length <= 256 && !/\s/.test(secret));
}

export async function publicGatewaySecretMatches(expected: string, candidate: string | undefined) {
  if (!validPublicGatewaySecret(expected) || !candidate || candidate.length > 256) {
    return false;
  }

  const [expectedDigest, candidateDigest] = await Promise.all([
    sha256(expected),
    sha256(candidate)
  ]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= expectedDigest[index] ^ candidateDigest[index];
  }
  return difference === 0;
}

export function assertPublicGatewayRateLimitKey(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Public gateway rate-limit key is invalid");
  }
  return value;
}

export function publicGatewayRateLimitIdentity(value: string) {
  return assertPublicGatewayRateLimitKey(value);
}

export function nextPublicGatewayRateLimit(
  existing: StoredRateLimit | null,
  now: number,
  policy: PublicGatewayRateLimitPolicy
) {
  if (!existing || now >= existing.windowExpiresAt) {
    return {
      allowed: true as const,
      count: 1,
      windowStartedAt: now,
      windowExpiresAt: now + policy.windowMs,
      retryAfterSeconds: 0
    };
  }

  if (existing.count >= policy.limit) {
    return {
      allowed: false as const,
      count: existing.count,
      windowStartedAt: existing.windowStartedAt,
      windowExpiresAt: existing.windowExpiresAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.windowExpiresAt - now) / 1000))
    };
  }

  return {
    allowed: true as const,
    count: existing.count + 1,
    windowStartedAt: existing.windowStartedAt,
    windowExpiresAt: existing.windowExpiresAt,
    retryAfterSeconds: 0
  };
}

export async function consumePublicGatewayRateLimit(
  ctx: Pick<MutationCtx, "db">,
  operation: PublicGatewayOperation,
  rawKeyHash: string,
  now = Date.now()
) {
  const keyHash = publicGatewayRateLimitIdentity(rawKeyHash);
  const clientPolicy = publicGatewayRateLimitPolicies[operation];
  const globalPolicy = publicGatewayGlobalRateLimitPolicies[operation];
  await cleanupExpiredPublicGatewayRateLimits(ctx, now);
  const [existingClient, existingGlobal] = await Promise.all([
    findRateLimit(ctx, operation, keyHash),
    findRateLimit(ctx, operation, globalRateLimitKey)
  ]);
  const nextClient = nextPublicGatewayRateLimit(existingClient, now, clientPolicy);
  const nextGlobal = nextPublicGatewayRateLimit(existingGlobal, now, globalPolicy);

  if (!nextClient.allowed || !nextGlobal.allowed) {
    throw new ConvexError({
      code: "rate_limited",
      retryAfterSeconds: Math.max(nextClient.retryAfterSeconds, nextGlobal.retryAfterSeconds)
    });
  }

  await writeRateLimit(ctx, operation, keyHash, existingClient, nextClient, now);
  await writeRateLimit(ctx, operation, globalRateLimitKey, existingGlobal, nextGlobal, now);

  return {
    remaining: Math.max(0, clientPolicy.limit - nextClient.count),
    globalRemaining: Math.max(0, globalPolicy.limit - nextGlobal.count),
    windowExpiresAt: nextClient.windowExpiresAt
  };
}

export async function cleanupExpiredPublicGatewayRateLimits(
  ctx: Pick<MutationCtx, "db">,
  now = Date.now(),
  batchSize = 100
) {
  const boundedBatchSize = Math.max(1, Math.min(500, Math.floor(batchSize)));
  const expired = await ctx.db
    .query("publicGatewayRateLimits")
    .withIndex("by_windowExpiresAt", (query) => query.lt("windowExpiresAt", now))
    .take(boundedBatchSize);
  for (const row of expired) {
    await ctx.db.delete(row._id);
  }
  return { deleted: expired.length };
}

export function publicGatewayRateLimitError(error: unknown) {
  if (!(error instanceof ConvexError) || !error.data || typeof error.data !== "object") {
    return null;
  }
  const data = error.data as { code?: unknown; retryAfterSeconds?: unknown };
  if (
    data.code !== "rate_limited" ||
    typeof data.retryAfterSeconds !== "number" ||
    !Number.isFinite(data.retryAfterSeconds)
  ) {
    return null;
  }
  return {
    retryAfterSeconds: Math.max(1, Math.ceil(data.retryAfterSeconds))
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function findRateLimit(
  ctx: Pick<MutationCtx, "db">,
  operation: PublicGatewayOperation,
  keyHash: string
) {
  return ctx.db
    .query("publicGatewayRateLimits")
    .withIndex("by_operation_keyHash", (query) =>
      query.eq("operation", operation).eq("keyHash", keyHash)
    )
    .unique();
}

async function writeRateLimit(
  ctx: Pick<MutationCtx, "db">,
  operation: PublicGatewayOperation,
  keyHash: string,
  existing: Awaited<ReturnType<typeof findRateLimit>>,
  next: ReturnType<typeof nextPublicGatewayRateLimit> & { allowed: true },
  now: number
) {
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: next.count,
      windowStartedAt: next.windowStartedAt,
      windowExpiresAt: next.windowExpiresAt,
      updatedAt: now
    });
    return;
  }
  await ctx.db.insert("publicGatewayRateLimits", {
    operation,
    keyHash,
    count: next.count,
    windowStartedAt: next.windowStartedAt,
    windowExpiresAt: next.windowExpiresAt,
    updatedAt: now
  });
}
