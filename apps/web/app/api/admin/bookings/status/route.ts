import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  optionalString,
  requiredString,
  staffAuthRequiredResponse
} from "../../_shared";

type BookingAdminStatus = "confirmed" | "checked-in" | "cancelled";

type BookingStatusRequest = {
  bookingRef?: unknown;
  status?: unknown;
  note?: unknown;
};

type BookingStatusMutationArgs = {
  bookingRef: string;
  status: BookingAdminStatus;
  note?: string;
};

type BookingStatusMutationResult = {
  bookingRef: string;
  status: string;
  emailLower?: string;
  visitDate?: string;
  checkedInAt?: number;
  cancelledAt?: number;
  updatedAt?: number;
};

const updateBookingStatusMutation = makeFunctionReference<
  "mutation",
  BookingStatusMutationArgs,
  BookingStatusMutationResult
>("admin:updateBookingStatus");

const bookingStatuses = new Set<BookingAdminStatus>(["confirmed", "checked-in", "cancelled"]);

function parseBookingStatus(value: unknown) {
  const status = requiredString(value, "status", 24);
  if (!bookingStatuses.has(status as BookingAdminStatus)) {
    throw new Error("booking status is not recognized");
  }
  return status as BookingAdminStatus;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Booking Status");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Booking Status");
    }

    const input = (await request.json()) as BookingStatusRequest;
    const result = await fetchMutation(
      updateBookingStatusMutation,
      withoutUndefined({
        bookingRef: requiredString(input.bookingRef, "bookingRef", 80),
        status: parseBookingStatus(input.status),
        note: optionalString(input.note, "note", 160)
      }),
      { url: deploymentUrl, token }
    );

    return Response.json({ booking: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update booking status";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
