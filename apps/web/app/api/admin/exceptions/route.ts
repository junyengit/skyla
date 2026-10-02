import { ConvexError } from "convex/values";
import {
  BillingRequestError, billingHttpFailure, normalizeBillingPageRequest,
  parseBillingBackendReadError, parseBillingExceptionPage, type BillingPageRequest
} from "@/lib/billing-contract";
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

const listOperationsExceptionsPage = makeFunctionReference<"query", BillingPageRequest, unknown>(
  "operationsExceptions:listOperationsExceptionsPage"
);

function pageFailure(code: Parameters<typeof billingHttpFailure>[0]) {
  const { body, status } = billingHttpFailure(code);
  return adminJson(body, { status });
}
async function getPage(request: Request) {
  try {
    const args = normalizeBillingPageRequest(new URL(request.url).searchParams);
    const token = authToken(request);
    if (!token) return pageFailure("billing_auth_required");
    const url = convexUrl();
    if (!url) return pageFailure("billing_read_unverified");
    return adminJson(parseBillingExceptionPage(await fetchQuery(listOperationsExceptionsPage, args, { url, token }), args));
  } catch (error) {
    if (error instanceof BillingRequestError) return pageFailure("billing_request_rejected");
    if (error instanceof ConvexError) {
      try { return pageFailure(parseBillingBackendReadError(error.data).code); }
      catch { /* Unknown or foreign receipts remain unverified. */ }
    }
    return pageFailure("billing_read_unverified");
  }
}

/** Read-only staff view of billing, attempt and delivery exceptions. */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has("page")) return getPage(request);
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
