import {
  callPublicConvexGateway,
  PublicGatewayError,
  publicGatewayErrorResponse
} from "../../../../../lib/public-convex-gateway";
import { ticketSalesUnavailableResponse } from "../../../ticket-sales-gate";

type ReleaseResult = { released: boolean; status?: string };

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

/**
 * Releases the capacity of a reviewed draft the guest replaced. Convex only
 * releases an order that is still a draft for this idempotency key; an order
 * with a payment attempt is never released here.
 */
export async function POST(request: Request) {
  const unavailable = ticketSalesUnavailableResponse(request);
  if (unavailable) {
    return unavailable;
  }

  let input: { orderRef: string; idempotencyKey: string };
  try {
    const body = (await request.json()) as { orderRef?: unknown; idempotencyKey?: unknown };
    input = {
      orderRef: requiredString(body.orderRef, "orderRef"),
      idempotencyKey: requiredString(body.idempotencyKey, "idempotencyKey")
    };
  } catch {
    return Response.json(
      { error: "orderRef and idempotencyKey are required", code: "invalid_request" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const result = await callPublicConvexGateway<ReleaseResult>(request, "checkout-draft-release", input);
    return Response.json({ released: result.released === true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicGatewayError) {
      return publicGatewayErrorResponse(error, "Could not release the checkout draft");
    }
    return Response.json(
      { error: "Could not release the checkout draft", code: "upstream_failure" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}
