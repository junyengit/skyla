import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { convexUnconfiguredResponse, convexUrl, optionalString, requiredString } from "../../admin/_shared";

type InquiryExperience =
  | "date-night"
  | "champagne-caviar"
  | "family-suite"
  | "champagne-room"
  | "private-events"
  | "other";

type ExperienceInquiryRequest = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  experience?: unknown;
  eventDate?: unknown;
  guestCount?: unknown;
  notes?: unknown;
  source?: unknown;
  idempotencyKey?: unknown;
};

type ExperienceInquiryMutationArgs = {
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

type ExperienceInquiryMutationResult = {
  inquiryId: string;
  emailLower: string;
  experience: InquiryExperience;
  eventDate: string;
  guestCount: string;
  status: "pending";
  createdAt: number;
  updatedAt?: number;
  replayed: boolean;
};

const submitInquiryMutation = makeFunctionReference<
  "mutation",
  ExperienceInquiryMutationArgs,
  ExperienceInquiryMutationResult
>("inquiries:submitInquiry");

const inquiryExperiences = new Set<InquiryExperience>([
  "date-night",
  "champagne-caviar",
  "family-suite",
  "champagne-room",
  "private-events",
  "other"
]);
const guestCounts = new Set(["2", "3", "4", "5", "6", "7", "8", "9-12", "13+"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const eventDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;

function parseExperience(value: unknown) {
  const experience = requiredString(value, "experience", 40);
  if (!inquiryExperiences.has(experience as InquiryExperience)) {
    throw new Error("experience is not recognized");
  }
  return experience as InquiryExperience;
}

function parseEventDate(value: unknown) {
  const eventDate = requiredString(value, "eventDate", 32);
  if (!eventDatePattern.test(eventDate)) {
    throw new Error("eventDate must be YYYY-MM-DD");
  }
  return eventDate;
}

function parseGuestCount(value: unknown) {
  const guestCount = requiredString(value, "guestCount", 16);
  if (!guestCounts.has(guestCount)) {
    throw new Error("guestCount is not recognized");
  }
  return guestCount;
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
  if (normalized.includes("different inquiry")) {
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
      return convexUnconfiguredResponse("Experience Inquiries");
    }

    const input = (await request.json()) as ExperienceInquiryRequest;
    const result = await fetchMutation(
      submitInquiryMutation,
      withoutUndefined({
        firstName: requiredString(input.firstName, "firstName", 80),
        lastName: requiredString(input.lastName, "lastName", 80),
        email: parseEmail(input.email),
        experience: parseExperience(input.experience),
        eventDate: parseEventDate(input.eventDate),
        guestCount: parseGuestCount(input.guestCount),
        notes: optionalString(input.notes, "notes", 2000),
        source: optionalString(input.source, "source", 120),
        idempotencyKey: parseIdempotencyKey(input.idempotencyKey)
      }),
      { url: deploymentUrl }
    );

    return Response.json({ inquiry: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit experience inquiry";
    const status = failureStatus(message);
    return Response.json({ error: status === 502 ? "Could not submit experience inquiry" : message }, { status });
  }
}
