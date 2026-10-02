import { fetchMutation, fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { parseVisitDate } from "@skyla/payments";

import {
  adminFailureStatus,
  adminJson,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  optionalString,
  requiredString,
  staffAuthRequiredResponse
} from "../_shared";

type PrivateEvent = {
  eventRef: string;
  visitDate: string;
  status: "confirmed" | "cancelled";
  label: string;
  notes?: string;
  createdAt: number;
  cancelledAt?: number;
  cancelReason?: string;
};

type PrivateEventCreateArgs = {
  visitDate: string;
  label: string;
  notes?: string;
  idempotencyKey: string;
};

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;

const listPrivateEventsQuery = makeFunctionReference<
  "query",
  { fromDate?: string; limit?: number },
  { fromDate: string; events: PrivateEvent[] }
>("privateEvents:listPrivateEvents");

const createPrivateEventMutation = makeFunctionReference<
  "mutation",
  PrivateEventCreateArgs,
  { event: PrivateEvent; reused: boolean }
>("privateEvents:createPrivateEvent");

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function visitDateValue(value: unknown, label: string) {
  const visitDate = parseVisitDate(value);
  if (!visitDate) {
    throw new Error(`${label} must be a real YYYY-MM-DD date`);
  }
  return visitDate;
}

function parseLimit(value: string | null) {
  if (value === null) return undefined;
  if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw new Error("limit must be a whole number from 1 to 100");
  }
  return Number(value);
}

function parseCreateRequest(value: unknown): PrivateEventCreateArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("private event request must be an object");
  }
  const input = value as Record<string, unknown>;
  const idempotencyKey = requiredString(input.idempotencyKey, "idempotencyKey", 96);
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return withoutUndefined({
    visitDate: visitDateValue(input.visitDate, "visitDate"),
    label: requiredString(input.label, "label", 120),
    notes: optionalString(input.notes, "notes", 500),
    idempotencyKey
  });
}

/** Staff calendar read for admins and viewers. */
export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("private events");
    }
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("private events");
    }

    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const result = await fetchQuery(
      listPrivateEventsQuery,
      withoutUndefined({
        fromDate: from === null ? undefined : visitDateValue(from, "from"),
        limit: parseLimit(params.get("limit"))
      }),
      { url: deploymentUrl, token }
    );
    return adminJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load private events";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}

/** Admin-only: records a confirmed whole-date private event. */
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

    const args = parseCreateRequest(await request.json());
    const result = await fetchMutation(createPrivateEventMutation, args, { url: deploymentUrl, token });
    return adminJson(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the private event";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
