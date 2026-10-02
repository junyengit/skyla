import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { admissionMaxPartySize, parseVisitDate } from "@skyla/payments";

import { parseVisitAvailability, parseVisitPartySize } from "../../../lib/visit-availability";

// Read-only aggregate availability. It stays available while ticket sales are
// switched off: it creates nothing, and the purchase routes remain locked.
const getPublicVisitAvailabilityQuery = makeFunctionReference<
  "query",
  { visitDate: string; partySize: number },
  unknown
>("availability:getPublicVisitAvailability");

function availabilityJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const visitDate = parseVisitDate(params.get("date"));
  if (!visitDate) {
    return availabilityJson({ error: "date must be a real YYYY-MM-DD date", code: "invalid_request" }, 400);
  }
  const partySize = parseVisitPartySize(params.get("party"));
  if (partySize === null) {
    return availabilityJson(
      { error: `party must be a whole number from 1 to ${admissionMaxPartySize}`, code: "invalid_request" },
      400
    );
  }

  const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!deploymentUrl) {
    return availabilityJson({ error: "Live availability is unavailable", code: "availability_unavailable" }, 503);
  }

  try {
    const availability = parseVisitAvailability(
      await fetchQuery(getPublicVisitAvailabilityQuery, { visitDate, partySize }, { url: deploymentUrl })
    );
    if (!availability || availability.visitDate !== visitDate || availability.partySize !== partySize) {
      return availabilityJson({ error: "Live availability is unavailable", code: "availability_invalid" }, 502);
    }
    return availabilityJson(availability);
  } catch {
    return availabilityJson({ error: "Live availability is unavailable", code: "availability_unavailable" }, 503);
  }
}
