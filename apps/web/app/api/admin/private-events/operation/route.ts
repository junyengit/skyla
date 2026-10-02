import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  CalendarRequestError, CalendarResponseError, calendarQueryParameters, normalizeCalendarOperationLookup, parseCalendarOperationResult
} from "@/lib/calendar-contract";
import {
  adminFailureStatus, adminJson, authToken, convexUnconfiguredResponse,
  convexUrl, staffAuthRequiredResponse
} from "../../_shared";

const operation = makeFunctionReference<"query", { idempotencyKey?: string; eventRef?: string }, unknown>("privateEvents:getPrivateEventOperation");

/** An absent event does not prove an earlier mutation failed. */
export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("private events");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("private events");
    const params = new URL(request.url).searchParams;
    calendarQueryParameters(params, ["key", "event"]);
    const lookup = normalizeCalendarOperationLookup({
      ...(params.has("key") ? { key: params.get("key") } : {}),
      ...(params.has("event") ? { eventRef: params.get("event") } : {})
    });
    const args = "key" in lookup ? { idempotencyKey: lookup.key } : { eventRef: lookup.eventRef };
    const result = await fetchQuery(operation, args, { url, token });
    return adminJson(parseCalendarOperationResult(result, lookup));
  } catch (error) {
    if (error instanceof CalendarRequestError) return adminJson({ error: error.message, code: "calendar_request_rejected" }, { status: 400 });
    if (error instanceof CalendarResponseError) return adminJson({ error: error.message, code: "calendar_response_unverified" }, { status: 502 });
    const message = error instanceof Error ? error.message : "Could not verify the private event operation";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
