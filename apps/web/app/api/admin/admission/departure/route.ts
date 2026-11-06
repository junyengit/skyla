import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { adminFailureStatus, adminJson, authToken, convexUrl, convexUnconfiguredResponse, requiredString, staffAuthRequiredResponse } from "../../_shared";

const departure = makeFunctionReference<"mutation">("admissions:recordDeparture");
export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("Admission departure");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("Admission departure");
    const body = await request.json() as { bookingRef?: unknown; departedCount?: unknown };
    if (typeof body.departedCount !== "number" || !Number.isSafeInteger(body.departedCount) || body.departedCount < 1 || body.departedCount > 30) {
      throw new Error("departedCount must be an integer from 1 to 30");
    }
    return adminJson(await fetchMutation(departure, { bookingRef: requiredString(body.bookingRef, "bookingRef", 80), departedCount: body.departedCount }, { token, url }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record departure";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
