import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { adminFailureStatus, adminJson, authToken, convexUrl, convexUnconfiguredResponse, staffAuthRequiredResponse } from "../../_shared";

const occupancy = makeFunctionReference<"query">("admissions:getOccupancy");
export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("Admission occupancy");
    const url = convexUrl();
    if (!url) return convexUnconfiguredResponse("Admission occupancy");
    return adminJson(await fetchQuery(occupancy, {}, { token, url }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load physical occupancy";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
