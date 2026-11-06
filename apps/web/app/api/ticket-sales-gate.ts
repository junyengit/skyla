import { siteConfig } from "@skyla/config";

import { sandboxPurchaseRequestAllowed, verifiedSandboxAdmissionOrigin } from "../../lib/sandbox-admission";

export const ticketSalesNotLiveCode = "ticket_sales_not_live" as const;
export const sandboxOriginRejectedCode = "sandbox_origin_rejected" as const;

export function ticketSalesUnavailableResponse(request: Request) {
  if (siteConfig.launched) {
    return undefined;
  }

  const sandboxOrigin = verifiedSandboxAdmissionOrigin();
  if (!sandboxOrigin) {
    return Response.json(
      {
        error: siteConfig.launchStatus.message,
        code: ticketSalesNotLiveCode
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  if (!sandboxPurchaseRequestAllowed(request, sandboxOrigin)) {
    return Response.json(
      {
        error: "Test checkout accepts requests only from its approved preview address.",
        code: sandboxOriginRejectedCode
      },
      {
        status: 403,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  return undefined;
}
