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

type BookingVoucherAction = "redeem" | "undo";

type BookingVoucherRequest = {
  bookingRef?: unknown;
  voucherId?: unknown;
  action?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type BookingVoucherMutationArgs = {
  bookingRef: string;
  voucherId: string;
  action: BookingVoucherAction;
  note?: string;
  idempotencyKey?: string;
};

type BookingVoucherMutationResult = {
  bookingRef: string;
  status: string;
  vouchers?: {
    summary: {
      total: number;
      redeemed: number;
      remaining: number;
    };
    items: Array<{
      id: string;
      label: string;
      quantity: number;
      redeemed: number;
      remaining: number;
      source: "package" | "addon";
      packageKey?: string;
      addonKey?: string;
    }>;
  };
};

const updateBookingVoucherMutation = makeFunctionReference<
  "mutation",
  BookingVoucherMutationArgs,
  BookingVoucherMutationResult
>("admin:updateBookingVoucherRedemption");

const voucherActions = new Set<BookingVoucherAction>(["redeem", "undo"]);

function parseVoucherAction(value: unknown) {
  const action = requiredString(value, "action", 24);
  if (!voucherActions.has(action as BookingVoucherAction)) {
    throw new Error("voucher action is not recognized");
  }
  return action as BookingVoucherAction;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Booking Vouchers");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Booking Vouchers");
    }

    const input = (await request.json()) as BookingVoucherRequest;
    const result = await fetchMutation(
      updateBookingVoucherMutation,
      withoutUndefined({
        bookingRef: requiredString(input.bookingRef, "bookingRef", 80),
        voucherId: requiredString(input.voucherId, "voucherId", 80),
        action: parseVoucherAction(input.action),
        note: optionalString(input.note, "note", 160),
        idempotencyKey: optionalString(input.idempotencyKey, "idempotencyKey", 120)
      }),
      { url: deploymentUrl, token }
    );

    return Response.json({ booking: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update booking voucher";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
