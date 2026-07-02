export type InquiryExperience =
  | "date-night"
  | "champagne-caviar"
  | "family-suite"
  | "champagne-room"
  | "private-events"
  | "other";

export type InquiryArgs = {
  firstName: string;
  lastName: string;
  email: string;
  experience: InquiryExperience;
  eventDate: string;
  guestCount: string;
  notes?: string;
  source?: string;
  idempotencyKey: string;
};

export type NormalizedInquiryArgs = InquiryArgs & {
  emailLower: string;
};

type Jsonish = string | number | boolean | null | Jsonish[] | { [key: string]: Jsonish | undefined };

export const inquiryExperiences = [
  "date-night",
  "champagne-caviar",
  "family-suite",
  "champagne-room",
  "private-events",
  "other"
] as const;

export const inquiryGuestCounts = ["2", "3", "4", "5", "6", "7", "8", "9-12", "13+"] as const;

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

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

export function normalizeInquiryIdempotencyKey(value: string) {
  const key = value.trim();
  if (!idempotencyKeyPattern.test(key)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return key;
}

export function normalizeInquiryArgs(args: InquiryArgs): NormalizedInquiryArgs {
  const email = requiredTrimmed(args.email, "email", 254);
  const emailLower = email.toLowerCase();
  if (!emailPattern.test(emailLower)) {
    throw new Error("email must be a valid email address");
  }
  if (!inquiryExperiences.includes(args.experience)) {
    throw new Error("experience is not recognized");
  }
  const eventDate = requiredTrimmed(args.eventDate, "eventDate", 32);
  if (!datePattern.test(eventDate)) {
    throw new Error("eventDate must be YYYY-MM-DD");
  }
  const guestCount = requiredTrimmed(args.guestCount, "guestCount", 16);
  if (!inquiryGuestCounts.includes(guestCount as (typeof inquiryGuestCounts)[number])) {
    throw new Error("guestCount is not recognized");
  }

  return withoutUndefined({
    firstName: requiredTrimmed(args.firstName, "firstName", 80),
    lastName: requiredTrimmed(args.lastName, "lastName", 80),
    email,
    emailLower,
    experience: args.experience,
    eventDate,
    guestCount,
    notes: optionalTrimmed(args.notes, "notes", 2000),
    source: optionalTrimmed(args.source, "source", 120),
    idempotencyKey: normalizeInquiryIdempotencyKey(args.idempotencyKey)
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

export function inquiryFingerprint(input: NormalizedInquiryArgs) {
  return `v1:${stableJson({
    firstName: input.firstName,
    lastName: input.lastName,
    emailLower: input.emailLower,
    experience: input.experience,
    eventDate: input.eventDate,
    guestCount: input.guestCount,
    notes: input.notes,
    source: input.source
  })}`;
}

export function assertSameInquiryFingerprint(existingFingerprint: string | undefined, nextFingerprint: string) {
  if (existingFingerprint !== nextFingerprint) {
    throw new Error("idempotencyKey was already used for a different inquiry");
  }
}

export function inquiryAuditMetadata(input: NormalizedInquiryArgs) {
  const metadata: Record<string, string> = {
    emailLower: input.emailLower,
    experience: input.experience,
    eventDate: input.eventDate,
    guestCount: input.guestCount
  };
  if (input.source) {
    metadata.source = input.source;
  }
  return metadata;
}

export function inquiryResult(
  inquiryId: string,
  inquiry: NormalizedInquiryArgs & {
    status: string;
    createdAt: number;
    updatedAt?: number;
  },
  replayed = false
) {
  return withoutUndefined({
    inquiryId,
    emailLower: inquiry.emailLower,
    experience: inquiry.experience,
    eventDate: inquiry.eventDate,
    guestCount: inquiry.guestCount,
    status: inquiry.status,
    createdAt: inquiry.createdAt,
    updatedAt: inquiry.updatedAt,
    replayed
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
