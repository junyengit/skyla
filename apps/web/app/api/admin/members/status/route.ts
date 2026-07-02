import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  optionalString,
  requiredString,
  staffAuthRequiredResponse
} from "../../_shared";

type MemberAdminStatus = "pending" | "approved" | "waitlisted" | "rejected";

type MemberStatusRequest = {
  memberId?: unknown;
  status?: unknown;
  note?: unknown;
};

type MemberStatusMutationArgs = {
  memberId: string;
  status: MemberAdminStatus;
  note?: string;
};

type MemberStatusMutationResult = {
  memberId: string;
  status: string;
  emailLower?: string;
  tier?: string;
  updatedAt?: number;
};

const updateMemberStatusMutation = makeFunctionReference<
  "mutation",
  MemberStatusMutationArgs,
  MemberStatusMutationResult
>("admin:updateMemberStatus");

const memberStatuses = new Set<MemberAdminStatus>(["pending", "approved", "waitlisted", "rejected"]);

function parseMemberStatus(value: unknown) {
  const status = requiredString(value, "status", 24);
  if (!memberStatuses.has(status as MemberAdminStatus)) {
    throw new Error("member status is not recognized");
  }
  return status as MemberAdminStatus;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Member Status");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Member Status");
    }

    const input = (await request.json()) as MemberStatusRequest;
    const result = await fetchMutation(
      updateMemberStatusMutation,
      withoutUndefined({
        memberId: requiredString(input.memberId, "memberId", 120),
        status: parseMemberStatus(input.status),
        note: optionalString(input.note, "note", 160)
      }),
      { url: deploymentUrl, token }
    );

    return Response.json({ member: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update member status";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
