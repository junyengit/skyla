import { createCheckoutOrderDraft } from "@skyla/payments";
import {
  callPublicConvexGateway,
  PublicGatewayError,
  publicGatewayErrorResponse
} from "../../../../lib/public-convex-gateway";
import { ticketSalesUnavailableResponse } from "../../ticket-sales-gate";

type CheckoutDraftInput = Parameters<typeof createCheckoutOrderDraft>[0] & {
  idempotencyKey?: string;
  source?: string;
};
type CheckoutDraftMutationArgs = Required<Pick<CheckoutDraftInput, "packageKey" | "adults" | "idempotencyKey">> &
  Omit<CheckoutDraftInput, "packageKey" | "adults" | "idempotencyKey">;

type PersistedCheckoutDraftResult = {
  orderRef: string;
  status: "draft" | "payment_pending" | "expired";
  totals: {
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
  };
  visitDate?: string;
  entryTime?: string;
  customerEmail?: string;
  expiresAt: number;
  lines: ReturnType<typeof createCheckoutOrderDraft>["lines"];
};

function toDraftResponse(result: PersistedCheckoutDraftResult) {
  return {
    channel: "online" as const,
    status: result.status,
    currency: result.totals.currency,
    subtotalCents: result.totals.subtotalCents,
    feeCents: result.totals.feeCents,
    totalCents: result.totals.totalCents,
    lines: result.lines,
    visitDate: result.visitDate,
    entryTime: result.entryTime,
    customerEmail: result.customerEmail,
    expiresAt: result.expiresAt,
    orderRef: result.orderRef
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function POST(request: Request) {
  const unavailable = ticketSalesUnavailableResponse();
  if (unavailable) {
    return unavailable;
  }

  try {
    const input = (await request.json()) as CheckoutDraftInput;
    const draft = createCheckoutOrderDraft(input);

    if (input.idempotencyKey) {
      try {
        const result = await callPublicConvexGateway<PersistedCheckoutDraftResult>(
          request,
          "checkout-draft",
          withoutUndefined({
            packageKey: input.packageKey,
            adults: input.adults,
            children: input.children,
            addons: input.addons,
            visitDate: input.visitDate,
            entryTime: input.entryTime,
            customerEmail: input.customerEmail,
            source: "next-route",
            idempotencyKey: input.idempotencyKey
          }) satisfies CheckoutDraftMutationArgs
        );

        return Response.json({
          draft: toDraftResponse(result),
          orderRef: result.orderRef,
          persisted: true
        });
      } catch (error) {
        if (error instanceof PublicGatewayError) {
          const response = publicGatewayErrorResponse(error, "Could not persist checkout order draft");
          return Response.json(
            { ...(await response.json()), persisted: false },
            { status: response.status, headers: response.headers }
          );
        }
        const message = error instanceof Error ? error.message : "Could not persist checkout order draft";
        const status = message.includes("different draft") ? 409 : message.includes("idempotencyKey must") ? 400 : 502;

        return Response.json({ error: message, persisted: false }, { status });
      }
    }

    return Response.json({
      draft,
      persisted: false,
      persistenceReason: "idempotencyKey_required"
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create checkout order draft" },
      { status: 400 }
    );
  }
}
