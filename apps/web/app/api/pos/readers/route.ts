import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  adminFailureStatus,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  staffAuthRequiredResponse
} from "../../admin/_shared";

type TerminalReader = {
  label: string;
  readerId: string;
  terminalLocationId?: string;
};

type TerminalReadersResult = {
  staff: {
    emailLower: string;
    role: "admin" | "pos";
  };
  readers: TerminalReader[];
};

const listTerminalReadersQuery = makeFunctionReference<"query", Record<string, never>, TerminalReadersResult>(
  "admin:listTerminalReaders"
);

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("POS Terminal Readers");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("POS Terminal Readers");
    }

    const result = await fetchQuery(listTerminalReadersQuery, {}, { url: deploymentUrl, token });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load POS Terminal readers";
    return Response.json({ error: message }, { status: adminFailureStatus(message) });
  }
}
