import { fetchMutation, fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import {
  CalendarRequestError, CalendarResponseError, calendarCursor, calendarDate, calendarQueryParameters,
  normalizeCalendarCreateRequest, normalizeCalendarRange, parseCalendarLegacyList,
  parseCalendarAtomicRejection, parseCalendarMutationResult, parseCalendarRangePage,
  type CalendarCreateRequest, type CalendarMutationIdentity, type CalendarRangeRequest
} from "@/lib/calendar-contract";
import {
  adminFailureStatus, adminJson, authToken, convexUnconfiguredResponse,
  convexUrl, staffAuthRequiredResponse
} from "../_shared";

const legacyList = makeFunctionReference<"query", { fromDate?: string; limit?: number }, unknown>("privateEvents:listPrivateEvents");
const rangeList = makeFunctionReference<"query", CalendarRangeRequest, unknown>("privateEvents:listPrivateEventsRange");
const create = makeFunctionReference<"mutation", CalendarCreateRequest, unknown>("privateEvents:createPrivateEvent");

function parseLimit(value: string | null) {
  if (value === null) return undefined;
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error("limit must be a whole number from 1 to 100");
  return Number(value);
}
function failure(error: unknown, fallback: string) {
  if (error instanceof CalendarRequestError) return adminJson({ error: error.message, code: "calendar_request_rejected" }, { status: 400 });
  if (error instanceof CalendarResponseError) {
    return adminJson({ error: error.message, code: "calendar_response_unverified" }, { status: 502 });
  }
  const message = error instanceof Error ? error.message : fallback;
  return adminJson({ error: message }, { status: adminFailureStatus(message) });
}

/** Range reads are bounded and paginated; no-to reads retain legacy limits. */
export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("private events");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("private events");
    const params = new URL(request.url).searchParams;
    if (params.has("to")) {
      calendarQueryParameters(params, ["from", "to", "cursor", "endCursor"]);
      const range = normalizeCalendarRange({ from: params.get("from") as string, to: params.get("to") as string });
      const cursor = calendarCursor(params.get("cursor"));
      const endCursor = calendarCursor(params.get("endCursor"), "endCursor");
      const args = { ...range, ...(cursor ? { cursor } : {}), ...(endCursor ? { endCursor } : {}) };
      const result = await fetchQuery(rangeList, args, { url, token });
      return adminJson(parseCalendarRangePage(result, args));
    }
    calendarQueryParameters(params, ["from", "limit"]);
    const from = params.has("from") ? calendarDate(params.get("from"), "from") : undefined;
    const limit = parseLimit(params.get("limit"));
    const args = { ...(from ? { fromDate: from } : {}), ...(limit ? { limit } : {}) };
    const result = await fetchQuery(legacyList, args, { url, token });
    return adminJson(parseCalendarLegacyList(result, { from, limit }));
  } catch (error) { return failure(error, "Could not load private events"); }
}

/** Existing keys reach the backend before new-event date/source rules. */
export async function POST(request: Request) {
  let dispatched: CalendarMutationIdentity | null = null;
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("private events");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("private events");
    const args = normalizeCalendarCreateRequest(await request.json());
    dispatched = { kind: "create", request: args };
    const result = parseCalendarMutationResult(await fetchMutation(create, args, { url, token }), { kind: "create", request: args });
    return adminJson(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (!dispatched) {
      if (error instanceof SyntaxError) return adminJson({ error: "private event request must be valid JSON", code: "calendar_request_rejected" }, { status: 400 });
      return failure(error, "Could not verify the private event operation");
    }
    if (error instanceof ConvexError) {
      try {
        const rejection = parseCalendarAtomicRejection(error.data, dispatched);
        return adminJson({ error: rejection.message, code: "calendar_mutation_rejected", rejection }, { status: 409 });
      } catch { /* A malformed or foreign receipt is never no-commit proof. */ }
    }
    return adminJson({ error: "Calendar mutation outcome is unknown. Check the same operation before retrying.", code: "calendar_mutation_unknown" }, { status: 502 });
  }
}
