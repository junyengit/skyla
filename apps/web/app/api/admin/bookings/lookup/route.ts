import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  requiredString,
  staffAuthRequiredResponse
} from "../../_shared";

type BookingLookupArgs = {
  query: string;
  limit?: number;
};

type BookingLookupResult = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  query: string;
  matchType: "bookingRef" | "email";
  matches: Array<{
    bookingRef: string;
    orderRef?: string;
    visitDate?: string;
    status: string;
    emailLower?: string;
    firstName?: string;
    lastName?: string;
    partySize?: number;
    checkedInAt?: number;
    cancelledAt?: number;
    createdAt: number;
    updatedAt?: number;
    legacyId?: string;
  }>;
};

const lookupBookingQuery = makeFunctionReference<"query", BookingLookupArgs, BookingLookupResult>(
  "admin:lookupBookingForCheckIn"
);

function parseLimit(value: string | null) {
  if (!value) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("limit must be an integer between 1 and 8");
  }
  return limit;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Booking Lookup");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Booking Lookup");
    }

    const url = new URL(request.url);
    const result = await fetchQuery(
      lookupBookingQuery,
      withoutUndefined({
        query: requiredString(url.searchParams.get("q"), "q", 120),
        limit: parseLimit(url.searchParams.get("limit"))
      }),
      { url: deploymentUrl, token }
    );

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not look up booking";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
