export type MemberTier = "obsidian" | "gold" | "black";

export type MemberApplicationArgs = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  tier: MemberTier;
  source?: string;
  bio?: string;
  idempotencyKey: string;
};

export type NormalizedMemberApplicationArgs = MemberApplicationArgs & {
  emailLower: string;
};

type Jsonish = string | number | boolean | null | Jsonish[] | { [key: string]: Jsonish | undefined };

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const memberTiers = new Set<MemberTier>(["obsidian", "gold", "black"]);

function requiredTrimmed(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined, label: string, maxLength: number) {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

export function normalizeMemberApplicationIdempotencyKey(value: string) {
  const key = value.trim();
  if (!idempotencyKeyPattern.test(key)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return key;
}

export function normalizeMemberApplicationArgs(args: MemberApplicationArgs): NormalizedMemberApplicationArgs {
  const email = requiredTrimmed(args.email, "email", 254);
  const emailLower = email.toLowerCase();
  if (!emailPattern.test(emailLower)) {
    throw new Error("email must be a valid email address");
  }
  if (!memberTiers.has(args.tier)) {
    throw new Error("tier is not recognized");
  }

  return withoutUndefined({
    firstName: requiredTrimmed(args.firstName, "firstName", 80),
    lastName: requiredTrimmed(args.lastName, "lastName", 80),
    email,
    emailLower,
    phone: optionalTrimmed(args.phone, "phone", 40),
    tier: args.tier,
    source: optionalTrimmed(args.source, "source", 120),
    bio: optionalTrimmed(args.bio, "bio", 2000),
    idempotencyKey: normalizeMemberApplicationIdempotencyKey(args.idempotencyKey)
  });
}

function stableJson(value: Jsonish): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] as Jsonish)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function memberApplicationFingerprint(input: NormalizedMemberApplicationArgs) {
  return `v1:${stableJson({
    firstName: input.firstName,
    lastName: input.lastName,
    emailLower: input.emailLower,
    phone: input.phone,
    tier: input.tier,
    source: input.source,
    bio: input.bio
  })}`;
}

export function assertSameMemberApplicationFingerprint(existingFingerprint: string | undefined, nextFingerprint: string) {
  if (existingFingerprint !== nextFingerprint) {
    throw new Error("idempotencyKey was already used for a different member application");
  }
}

export function memberApplicationAuditMetadata(input: NormalizedMemberApplicationArgs) {
  const metadata: Record<string, string> = {
    emailLower: input.emailLower,
    tier: input.tier
  };
  if (input.source) {
    metadata.source = input.source;
  }
  return metadata;
}

export function memberApplicationResult(
  memberId: string,
  member: NormalizedMemberApplicationArgs & {
    status: string;
    createdAt: number;
    updatedAt?: number;
  },
  replayed = false
) {
  return withoutUndefined({
    memberId,
    emailLower: member.emailLower,
    tier: member.tier,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    replayed
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
