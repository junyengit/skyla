import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  invalidPaymentRequest,
  paymentForbidden,
  paymentJson,
  paymentServiceUnavailable
} from "../../_shared";

type PosSaleStatusResult = {
  saleRef: string;
  status: "draft" | "payment_pending" | "paid" | "canceled" | "expired";
  currency: "usd";
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  paymentStatus?: string;
  lines: Array<{
    kind: string;
    name: string;
    quantity: number;
    unitAmountCents: number;
    lineTotalCents: number;
  }>;
  bookingRef?: string;
  ticketCode?: string;
  updatedAt: number;
};

const getPosSaleStatusQuery = makeFunctionReference<
  "query",
  { saleRef: string },
  PosSaleStatusResult
>("posStatus:getPosSaleStatus");

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return undefined;
  return authorization.slice("bearer ".length).trim() || undefined;
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return paymentJson(
        { error: "Staff authentication is required for POS sale status", code: "staff_auth_required" },
        { status: 401 },
        { varyAuthorization: true }
      );
    }
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(paymentServiceUnavailable("POS sale status"), { status: 503 }, { varyAuthorization: true });
    }
    const input = (await request.json()) as { saleRef?: unknown };
    if (typeof input.saleRef !== "string" || !input.saleRef.trim() || input.saleRef.trim().length > 80) {
      return paymentJson(invalidPaymentRequest("A valid saleRef is required"), { status: 400 }, { varyAuthorization: true });
    }
    const result = await fetchQuery(
      getPosSaleStatusQuery,
      { saleRef: input.saleRef.trim() },
      { url: deploymentUrl, token }
    );
    return paymentJson(result, {}, { varyAuthorization: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load POS sale status";
    const normalized = message.toLowerCase();
    if (normalized.includes("staff role")) {
      return paymentJson(paymentForbidden("POS sale status"), { status: 403 }, { varyAuthorization: true });
    }
    if (normalized.includes("auth")) {
      return paymentJson(
        { error: "Staff authentication is required for POS sale status", code: "staff_auth_required" },
        { status: 401 },
        { varyAuthorization: true }
      );
    }
    if (normalized.includes("not found")) {
      return paymentJson(
        { error: "POS sale status was not found", code: "pos_sale_not_found" },
        { status: 404 },
        { varyAuthorization: true }
      );
    }
    return paymentJson(paymentServiceUnavailable("POS sale status"), { status: 502 }, { varyAuthorization: true });
  }
}
