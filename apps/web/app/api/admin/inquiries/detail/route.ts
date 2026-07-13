import { fetchQuery } from "convex/nextjs";
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

type InquiryDetailArgs = {
  inquiryId: string;
};

type InquiryDetailResult = {
  staff: {
    emailLower: string;
    role: "admin" | "viewer";
  };
  inquiry: {
    inquiryId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    status: string;
    experience?: string;
    eventDate?: string;
    guestCount?: string;
    notes?: string;
    source?: string;
    createdAt: number;
    updatedAt?: number;
    legacyId?: string;
  };
};

const getExperienceInquiryDetailQuery = makeFunctionReference<"query", InquiryDetailArgs, InquiryDetailResult>(
  "admin:getExperienceInquiryDetail"
);

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Inquiry Detail");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Inquiry Detail");
    }

    const inquiryId = requiredString(new URL(request.url).searchParams.get("inquiryId"), "inquiryId", 120);
    const result = await fetchQuery(getExperienceInquiryDetailQuery, { inquiryId }, { url: deploymentUrl, token });

    return adminJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load experience inquiry";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
