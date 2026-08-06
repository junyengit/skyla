import { siteConfig } from "@skyla/config";

export const ticketSalesNotLiveCode = "ticket_sales_not_live" as const;

export function ticketSalesUnavailableResponse() {
  if (siteConfig.launched) {
    return undefined;
  }

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
