import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { invalidPaymentRequest, paymentForbidden, paymentJson, paymentServiceUnavailable } from "../../payments/_shared";

type ReleaseResult = { released: boolean; status?: string };

const releasePosSaleDraftMutation = makeFunctionReference<
  "mutation",
  { saleRef: string; idempotencyKey: string },
  ReleaseResult
>("orderDrafts:releasePosSaleDraft");

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return undefined;
  return authorization.slice("bearer ".length).trim() || undefined;
}

/**
 * Releases a reviewed register sale the cashier changed or cleared. Convex
 * releases only a still-draft sale with no Terminal attempt; a sale whose
 * payment may be payable answers `released: false` and stays locked.
 */
export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return paymentJson(
        { error: "Staff authentication is required to release a POS sale", code: "staff_auth_required" },
        { status: 401 },
        { varyAuthorization: true }
      );
    }
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return paymentJson(paymentServiceUnavailable("POS sale release"), { status: 503 }, { varyAuthorization: true });
    }
    const input = (await request.json()) as { saleRef?: unknown; idempotencyKey?: unknown };
    const saleRef = typeof input.saleRef === "string" ? input.saleRef.trim() : "";
    const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
    if (!saleRef || saleRef.length > 80 || !idempotencyKeyPattern.test(idempotencyKey)) {
      return paymentJson(
        invalidPaymentRequest("A valid saleRef and idempotencyKey are required"),
        { status: 400 },
        { varyAuthorization: true }
      );
    }
    const result = await fetchMutation(releasePosSaleDraftMutation, { saleRef, idempotencyKey }, { url: deploymentUrl, token });
    return paymentJson(
      { released: result.released === true, ...(result.status ? { status: result.status } : {}) },
      {},
      { varyAuthorization: true }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("staff role") || message.includes("different staff user")) {
      return paymentJson(paymentForbidden("POS sale release"), { status: 403 }, { varyAuthorization: true });
    }
    if (message.includes("auth")) {
      return paymentJson(
        { error: "Staff authentication is required to release a POS sale", code: "staff_auth_required" },
        { status: 401 },
        { varyAuthorization: true }
      );
    }
    return paymentJson(paymentServiceUnavailable("POS sale release"), { status: 502 }, { varyAuthorization: true });
  }
}
