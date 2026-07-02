import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

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
  };
};

const getOperationsSnapshotQuery = makeFunctionReference<
  "query",
  OperationsSnapshotArgs,
  OperationsSnapshot
>("admin:getOperationsSnapshot");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = authorization.slice("bearer ".length).trim();
  return token || undefined;
}

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

function adminFailureStatus(message: string) {
  const normalized = message.toLowerCase();
  if (message.includes("limit must")) {
    return 400;
  }
  if (normalized.includes("auth") || normalized.includes("staff role")) {
    return 401;
  }
  if (normalized.includes("not configured")) {
    return 503;
  }
  return 502;
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return Response.json(
        {
          error: "Staff authentication is required for Admin Operations",
          code: "staff_auth_required"
        },
        { status: 401 }
      );
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return Response.json(
        {
          error: "Convex is not configured for Admin Operations",
          code: "convex_unconfigured"
        },
        { status: 503 }
      );
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
