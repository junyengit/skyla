import { createCheckoutOrderDraft } from "@skyla/payments";
import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

type CheckoutDraftInput = Parameters<typeof createCheckoutOrderDraft>[0] & {
  idempotencyKey?: string;
  source?: string;
};
type CheckoutDraftMutationArgs = Required<Pick<CheckoutDraftInput, "packageKey" | "adults" | "idempotencyKey">> &
  Omit<CheckoutDraftInput, "packageKey" | "adults" | "idempotencyKey">;

type PersistedCheckoutDraftResult = {
  orderRef: string;
  status: "draft";
  totals: {
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
  };
  visitDate?: string;
  entryTime?: string;
  customerEmail?: string;
  lines: ReturnType<typeof createCheckoutOrderDraft>["lines"];
};

const createCheckoutOrderDraftMutation = makeFunctionReference<
  "mutation",
  CheckoutDraftMutationArgs,
  PersistedCheckoutDraftResult
>("orderDrafts:createCheckoutOrderDraft");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

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
    orderRef: result.orderRef
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as CheckoutDraftInput;
    const draft = createCheckoutOrderDraft(input);
    const deploymentUrl = convexUrl();

    if (deploymentUrl && input.idempotencyKey) {
      try {
        const result = await fetchMutation(
          createCheckoutOrderDraftMutation,
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
          }),
          { url: deploymentUrl }
        );

        return Response.json({
          draft: toDraftResponse(result),
          orderRef: result.orderRef,
          persisted: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not persist checkout order draft";
        const status = message.includes("different draft") ? 409 : message.includes("idempotencyKey must") ? 400 : 502;

        return Response.json({ error: message, persisted: false }, { status });
      }
    }

    return Response.json({
      draft,
      persisted: false,
      persistenceReason: deploymentUrl ? "idempotencyKey_required" : "convex_unconfigured"
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create checkout order draft" },
      { status: 400 }
    );
  }
}
