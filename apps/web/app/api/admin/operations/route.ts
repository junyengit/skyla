import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  staffAuthRequiredResponse
} from "../_shared";

type OperationsSnapshotArgs = {
  limit?: number;
};

type OperationsSnapshot = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  readiness: {
    stripeSecret: boolean;
    stripeWebhookSecret: boolean;
    terminalReaderRegistry: boolean;
    paymentReturnOrigins: boolean;
  };
  counts: {
    draftOrders: { value: number; capped: boolean };
    pendingOrders: { value: number; capped: boolean };
    draftPosSales: { value: number; capped: boolean };
    pendingPosSales: { value: number; capped: boolean };
    pendingMembers: { value: number; capped: boolean };
    approvedMembers: { value: number; capped: boolean };
  };
  recent: {
    orders: Array<{
      orderRef: string;
      channel: "online" | "pos";
      status: string;
      totalCents: number;
      currency: "usd";
      expectedProvider?: string;
      customerEmailLower?: string;
      visitDate?: string;
      entryTime?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    posSales: Array<{
      saleRef: string;
      status: string;
      totalCents: number;
      currency: "usd";
      customerEmailLower?: string;
      readerId?: string;
      terminalLocationId?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    paymentEvents: Array<{
      orderRef?: string;
      saleRef?: string;
      provider: string;
      providerPaymentId: string;
      status: string;
      amountCents: number;
      currency: "usd";
      rawEventId?: string;
      createdAt: number;
    }>;
    bookings: Array<{
      bookingRef: string;
      orderRef?: string;
      visitDate?: string;
      status: string;
      emailLower?: string;
      checkedInAt?: number;
      cancelledAt?: number;
      createdAt: number;
      updatedAt?: number;
      legacyId?: string;
    }>;
    members: Array<{
      memberId: string;
      status: string;
      emailLower?: string;
      tier?: string;
      createdAt: number;
      updatedAt?: number;
      legacyId?: string;
    }>;
  };
};

const getOperationsSnapshotQuery = makeFunctionReference<
  "query",
  OperationsSnapshotArgs,
  OperationsSnapshot
>("admin:getOperationsSnapshot");

function parseLimit(request: Request) {
  const rawLimit = new URL(request.url).searchParams.get("limit");
  if (!rawLimit) {
    return undefined;
  }
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error("limit must be an integer from 1 to 25");
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Operations");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Operations");
    }

    const snapshot = await fetchQuery(
      getOperationsSnapshotQuery,
      { limit: parseLimit(request) },
      { url: deploymentUrl, token }
    );

    return Response.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Admin Operations";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
