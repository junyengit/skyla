import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import {
  BillingRequestError, billingHttpFailure, normalizeBillingDetailRequest,
  parseBillingBackendReadError, parseBillingDetail
} from "@/lib/billing-contract";
import { adminJson, authToken, convexUrl } from "../../_shared";

const detail = makeFunctionReference<"query", { exceptionId: string }, unknown>(
  "billingDetails:getOperationsExceptionDetail"
);
function failure(code: Parameters<typeof billingHttpFailure>[0]) {
  const { body, status } = billingHttpFailure(code);
  return adminJson(body, { status });
}

/** Fresh read of this exact exception. No provider request or mutation. */
export async function GET(request: Request) {
  let expected: { exceptionId: string } | undefined;
  try {
    expected = normalizeBillingDetailRequest(new URL(request.url).searchParams);
    const token = authToken(request);
    if (!token) return failure("billing_auth_required");
    const url = convexUrl();
    if (!url) return failure("billing_read_unverified");
    return adminJson(parseBillingDetail(await fetchQuery(detail, expected, { url, token }), expected));
  } catch (error) {
    if (error instanceof BillingRequestError) return failure("billing_request_rejected");
    if (error instanceof ConvexError) {
      try { return failure(parseBillingBackendReadError(error.data, expected).code); }
      catch { /* Only exact typed read receipts may classify a failure. */ }
    }
    return failure("billing_read_unverified");
  }
}
