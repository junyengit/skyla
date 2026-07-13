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

type TicketDeliveryResult = {
  bookingRef: string;
  ticketCode: string;
  status: "queued" | "sending" | "sent" | "failed" | "suppressed";
  attemptCount: number;
  sendVersion: number;
  updatedAt: number;
};

const requestTicketResendMutation = makeFunctionReference<
  "mutation",
  { bookingRef: string },
  TicketDeliveryResult
>("ticketDelivery:requestTicketResend");

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) return staffAuthRequiredResponse("Ticket Confirmation Resend");
    const deploymentUrl = convexUrl();
    if (!deploymentUrl) return convexUnconfiguredResponse("Ticket Confirmation Resend");
    const input = (await request.json()) as { bookingRef?: unknown };
    const delivery = await fetchMutation(
      requestTicketResendMutation,
      { bookingRef: requiredString(input.bookingRef, "bookingRef", 80) },
      { url: deploymentUrl, token }
    );
    return adminJson({ delivery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resend ticket confirmation";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
