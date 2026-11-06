import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  adminJson,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  staffAuthRequiredResponse
} from "../_shared";

type ListArgs = {
  status?: "open" | "resolved";
  limit?: number;
};

type OperationsExceptionList = {
  status: "open" | "resolved";
  capped: boolean;
  exceptions: Array<{
    category: "billing" | "checkout_attempt" | "terminal_attempt" | "ticket_delivery";
    code: string;
    status: "open" | "resolved";
    moneyReceived: boolean;
    orderRef?: string;
    saleRef?: string;
    bookingRef?: string;
    providerSessionIdMasked?: string;
    providerPaymentIntentIdMasked?: string;
    amountCents?: number;
    currency?: "usd";
    evidence?: Record<string, string | number | boolean>;
    occurrenceCount: number;
    firstSeenAt: number;
    lastSeenAt: number;
    resolvedAt?: number;
    resolution?: string;
  }>;
};

const listOperationsExceptionsQuery = makeFunctionReference<"query", ListArgs, OperationsExceptionList>(
  "operationsExceptions:listOperationsExceptions"
);

function parseArgs(request: Request): ListArgs {
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const rawLimit = params.get("limit");
  if (status !== null && status !== "open" && status !== "resolved") {
    throw new Error("status must be open or resolved");
  }
  let limit: number | undefined;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("limit must be an integer from 1 to 50");
    }
  }
  return {
    ...(status ? { status } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

/** Read-only staff view of billing, attempt and delivery exceptions. */
export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Operations Exceptions");
    }
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Operations Exceptions");
    }
    const result = await fetchQuery(listOperationsExceptionsQuery, parseArgs(request), { url: deploymentUrl, token });
    return adminJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Operations Exceptions";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
