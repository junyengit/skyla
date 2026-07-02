import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { convexUnconfiguredResponse, convexUrl, optionalString, requiredString } from "../../admin/_shared";

type MemberTier = "obsidian" | "gold" | "black";

type MemberApplicationRequest = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  tier?: unknown;
  source?: unknown;
  bio?: unknown;
  idempotencyKey?: unknown;
};

type MemberApplicationMutationArgs = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  tier: MemberTier;
  source?: string;
  bio?: string;
  idempotencyKey: string;
};

type MemberApplicationMutationResult = {
  memberId: string;
  emailLower: string;
  tier: MemberTier;
  status: "pending";
  createdAt: number;
  updatedAt?: number;
  replayed: boolean;
};

const submitMemberApplicationMutation = makeFunctionReference<
  "mutation",
  MemberApplicationMutationArgs,
  MemberApplicationMutationResult
>("memberApplications:submitApplication");

const memberTiers = new Set<MemberTier>(["obsidian", "gold", "black"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;

function parseTier(value: unknown) {
  const tier = requiredString(value, "tier", 24);
  if (!memberTiers.has(tier as MemberTier)) {
    throw new Error("tier is not recognized");
  }
  return tier as MemberTier;
}

function parseEmail(value: unknown) {
  const email = requiredString(value, "email", 254);
  if (!emailPattern.test(email.toLowerCase())) {
    throw new Error("email must be a valid email address");
  }
  return email;
}

function parseIdempotencyKey(value: unknown) {
  const idempotencyKey = requiredString(value, "idempotencyKey", 96);
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return idempotencyKey;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function failureStatus(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("different member application")) {
    return 409;
  }
  if (
    message.includes("is required") ||
    message.includes("must be") ||
    normalized.includes("not recognized") ||
    normalized.includes("valid email")
  ) {
    return 400;
  }
  if (normalized.includes("not configured")) {
    return 503;
  }
  return 502;
}

export async function POST(request: Request) {
  try {
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Member Applications");
    }

    const input = (await request.json()) as MemberApplicationRequest;
    const result = await fetchMutation(
      submitMemberApplicationMutation,
      withoutUndefined({
        firstName: requiredString(input.firstName, "firstName", 80),
        lastName: requiredString(input.lastName, "lastName", 80),
        email: parseEmail(input.email),
        phone: optionalString(input.phone, "phone", 40),
        tier: parseTier(input.tier),
        source: optionalString(input.source, "source", 120),
        bio: optionalString(input.bio, "bio", 2000),
        idempotencyKey: parseIdempotencyKey(input.idempotencyKey)
      }),
      { url: deploymentUrl }
    );

    return Response.json({ member: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit member application";
    const status = failureStatus(message);
    return Response.json({ error: status === 502 ? "Could not submit member application" : message }, { status });
  }
}
