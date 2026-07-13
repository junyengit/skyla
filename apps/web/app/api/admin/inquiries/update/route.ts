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

type InquiryAdminStatus = "pending" | "contacted" | "qualified" | "closed";

type InquiryUpdateRequest = {
  inquiryId?: unknown;
  status?: unknown;
  notes?: unknown;
};

type InquiryUpdateArgs = {
  inquiryId: string;
  status?: InquiryAdminStatus;
  notes?: string;
};

type InquiryUpdateResult = {
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

const updateExperienceInquiryMutation = makeFunctionReference<"mutation", InquiryUpdateArgs, InquiryUpdateResult>(
  "admin:updateExperienceInquiry"
);

const inquiryStatuses = new Set<InquiryAdminStatus>(["pending", "contacted", "qualified", "closed"]);

function parseStatus(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("inquiry status is not recognized");
  }
  const status = value.trim();
  if (!inquiryStatuses.has(status as InquiryAdminStatus)) {
    throw new Error("inquiry status is not recognized");
  }
  return status as InquiryAdminStatus;
}

function parseNotes(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("notes must be a string");
  }
  const notes = value.trim();
  if (notes.length > 2000) {
    throw new Error("notes must be 2000 characters or fewer");
  }
  return notes;
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Inquiry Update");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Inquiry Update");
    }

    const input = (await request.json()) as InquiryUpdateRequest;
    const status = parseStatus(input.status);
    const notes = parseNotes(input.notes);
    if (status === undefined && notes === undefined) {
      throw new Error("status or notes is required");
    }

    const result = await fetchMutation(
      updateExperienceInquiryMutation,
      {
        inquiryId: requiredString(input.inquiryId, "inquiryId", 120),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {})
      },
      { url: deploymentUrl, token }
    );

    return adminJson({ inquiry: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update experience inquiry";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
