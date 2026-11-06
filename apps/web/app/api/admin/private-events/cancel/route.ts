import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";

import {
  CalendarRequestError, CalendarResponseError, normalizeCalendarCancelRequest, parseCalendarAtomicRejection, parseCalendarMutationResult,
  type CalendarCancelRequest, type CalendarMutationIdentity
} from "@/lib/calendar-contract";
import {
  adminFailureStatus, adminJson, authToken, convexUnconfiguredResponse,
  convexUrl, staffAuthRequiredResponse
} from "../../_shared";

const cancel = makeFunctionReference<"mutation", CalendarCancelRequest, unknown>("privateEvents:cancelPrivateEvent");

/** Admin-only cancellation retains the original event and first reason. */
export async function POST(request: Request) {
  let dispatched: CalendarMutationIdentity | null = null;
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("private events");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("private events");
    const args = normalizeCalendarCancelRequest(await request.json());
    dispatched = { kind: "cancel", request: args };
    const result = await fetchMutation(cancel, args, { url, token });
    return adminJson(parseCalendarMutationResult(result, { kind: "cancel", request: args }));
  } catch (error) {
    if (dispatched) {
      if (error instanceof ConvexError) {
        try {
          const rejection = parseCalendarAtomicRejection(error.data, dispatched);
          return adminJson({ error: rejection.message, code: "calendar_mutation_rejected", rejection }, { status: 409 });
        } catch { /* An unbound receipt keeps the operation uncertain. */ }
      }
      return adminJson({ error: "Calendar mutation outcome is unknown. Check the same operation before retrying.", code: "calendar_mutation_unknown" }, { status: 502 });
    }
    if (error instanceof SyntaxError) return adminJson({ error: "private event cancellation must be valid JSON", code: "calendar_request_rejected" }, { status: 400 });
    if (error instanceof CalendarRequestError) return adminJson({ error: error.message, code: "calendar_request_rejected" }, { status: 400 });
    if (error instanceof CalendarResponseError) return adminJson({ error: error.message, code: "calendar_response_unverified" }, { status: 502 });
    const message = error instanceof Error ? error.message : "Could not verify the private event cancellation";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
