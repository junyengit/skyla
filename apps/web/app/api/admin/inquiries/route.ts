import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  adminFailureStatus,
  adminJson,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  staffAuthRequiredResponse
} from "../_shared";

type InquiryAdminStatus = "pending" | "contacted" | "qualified" | "closed";

type InquiryListArgs = {
  limit?: number;
  status?: InquiryAdminStatus;
};

type InquiryListResult = {
  staff: {
    emailLower: string;
    role: "admin" | "viewer";
  };
  inquiries: Array<{
    inquiryId: string;
    status: string;
    contactMasked?: string;
    experience?: string;
    eventDate?: string;
    guestCount?: string;
    source?: string;
    createdAt: number;
    updatedAt?: number;
    legacyId?: string;
  }>;
};

const listExperienceInquiriesQuery = makeFunctionReference<"query", InquiryListArgs, InquiryListResult>(
  "admin:listExperienceInquiries"
);

const inquiryStatuses = new Set<InquiryAdminStatus>(["pending", "contacted", "qualified", "closed"]);

function parseLimit(value: string | null) {
  if (!value) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("limit must be an integer between 1 and 50");
  }
  return limit;
}

function parseStatus(value: string | null) {
  if (!value) {
    return undefined;
  }
  const status = value.trim();
  if (!inquiryStatuses.has(status as InquiryAdminStatus)) {
    throw new Error("inquiry status is not recognized");
  }
  return status as InquiryAdminStatus;
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Inquiries");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Inquiries");
    }

    const searchParams = new URL(request.url).searchParams;
    const args = {
      limit: parseLimit(searchParams.get("limit")),
      status: parseStatus(searchParams.get("status"))
    };
    const result = await fetchQuery(listExperienceInquiriesQuery, args, { url: deploymentUrl, token });

    return adminJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load experience inquiries";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
