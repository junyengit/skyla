import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  adminFailureStatus,
  adminJson,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  requiredString,
  staffAuthRequiredResponse
} from "../../_shared";

const eventRefPattern = /^PEV\d{8}-[A-Z0-9]{6}$/;

const cancelPrivateEventMutation = makeFunctionReference<
  "mutation",
  { eventRef: string; reason: string },
  { event: Record<string, unknown>; reused: boolean }
>("privateEvents:cancelPrivateEvent");

function parseCancelRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("private event cancellation must be an object");
  }
  const input = value as Record<string, unknown>;
  const eventRef = requiredString(input.eventRef, "eventRef", 40);
  if (!eventRefPattern.test(eventRef)) {
    throw new Error("eventRef must be a private event reference");
  }
  return { eventRef, reason: requiredString(input.reason, "reason", 300) };
}

/** Admin-only cancellation; the record and its history are kept. */
export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("private events");
    }
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("private events");
    }

    const args = parseCancelRequest(await request.json());
    const result = await fetchMutation(cancelPrivateEventMutation, args, { url: deploymentUrl, token });
    return adminJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel the private event";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
