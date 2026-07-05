import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import { adminFailureStatus, authToken, convexUnconfiguredResponse, convexUrl, staffAuthRequiredResponse } from "../_shared";

type AcceptanceReadiness = {
  staff: {
    emailLower: string;
    role: "admin" | "pos";
  };
  stripe: {
    mode: "test" | "live" | "invalid" | "unset";
    secretConfigured: boolean;
    paymentReturnOriginsConfigured: boolean;
    webhookSecretConfigured: boolean;
    checkoutReady: boolean;
  };
  terminal: {
    readerRegistryConfigured: boolean;
    readerRegistryValid: boolean;
    readerCount: number;
    readerRegistryError?: string;
    acceptanceEnabled: boolean;
    readerProcessingReady: boolean;
  };
};

const getAcceptanceReadinessQuery = makeFunctionReference<"query", Record<string, never>, AcceptanceReadiness>(
  "admin:getAcceptanceReadiness"
);

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Acceptance Readiness");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Acceptance Readiness");
    }

    const readiness = await fetchQuery(getAcceptanceReadinessQuery, {}, { url: deploymentUrl, token });
    return Response.json(readiness);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Acceptance Readiness";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
