import { fetchMutation, fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

import {
  adminFailureStatus,
  adminJson,
  authToken,
  convexUnconfiguredResponse,
  convexUrl,
  optionalString,
  staffAuthRequiredResponse
} from "../_shared";

type StaffRole = "admin" | "pos" | "viewer";
type CatalogKind = "ticket" | "addon" | "cafe";
type CatalogVersionStatus = "active" | "inactive";

type CatalogItem = {
  key: string;
  kind: CatalogKind;
  name: string;
  priceCents: number;
  active: boolean;
  category?: string;
  metadata?: Record<string, string | number | boolean>;
  catalogVersion?: string;
  source?: string;
  authority?: string;
  contentHash?: string;
  updatedAt?: number;
};

type CatalogVersion = {
  version: string;
  source: string;
  authority: string;
  status: CatalogVersionStatus;
  itemCount: number;
  activeItemCount: number;
  contentHash: string;
  editableInAdmin: boolean;
  createdAt: number;
  activatedAt?: number;
  deactivatedAt?: number;
  notes?: string;
};

type CatalogSnapshot = {
  staff: {
    emailLower: string;
    role: StaffRole;
  };
  activeVersion: CatalogVersion | null;
  versions: CatalogVersion[];
  currentProducts: CatalogItem[];
  snapshot: {
    version: string;
    items: CatalogItem[];
  } | null;
};

type CatalogActionRequest = {
  action?: unknown;
  version?: unknown;
  note?: unknown;
  products?: unknown;
  prices?: unknown;
};

type CatalogMutationResult = {
  version: string;
  contentHash: string;
  itemCount: number;
  activeItemCount: number;
  syncedProducts: number;
  activatedAt: number;
  created?: boolean;
};

const getCatalogSnapshotQuery = makeFunctionReference<"query", { version?: string }, CatalogSnapshot>(
  "catalog:getCatalogSnapshot"
);

const seedCodeOwnedCatalogMutation = makeFunctionReference<"mutation", { note?: string }, CatalogMutationResult>(
  "catalog:seedCodeOwnedCatalog"
);

const activateCatalogVersionMutation = makeFunctionReference<
  "mutation",
  { version: string; note?: string },
  CatalogMutationResult
>("catalog:activateCatalogVersion");

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function parseAction(value: unknown) {
  if (value === "seedCodeOwnedCatalog" || value === "activateVersion") {
    return value;
  }
  throw new Error("catalog action is not recognized");
}

function parseVersion(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("version is required");
  }
  const version = value.trim();
  if (version.length > 120) {
    throw new Error("version must be 120 characters or fewer");
  }
  if (/[\u0000-\u001f\u007f]/.test(version)) {
    throw new Error("version must not contain control characters");
  }
  return version;
}

function parseOptionalVersion(value: string | null) {
  return value?.trim() ? parseVersion(value) : undefined;
}

function rejectBrowserCatalogPayload(input: CatalogActionRequest) {
  if (input.products !== undefined || input.prices !== undefined) {
    throw new Error("catalog prices are code-owned and cannot be submitted by the browser");
  }
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Catalog");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Catalog");
    }

    const url = new URL(request.url);
    const version = parseOptionalVersion(url.searchParams.get("version"));
    const snapshot = await fetchQuery(
      getCatalogSnapshotQuery,
      withoutUndefined({ version }),
      { url: deploymentUrl, token }
    );
    return adminJson(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Admin Catalog";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return staffAuthRequiredResponse("Admin Catalog");
    }

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return convexUnconfiguredResponse("Admin Catalog");
    }

    const input = (await request.json()) as CatalogActionRequest;
    rejectBrowserCatalogPayload(input);
    const action = parseAction(input.action);
    const note = optionalString(input.note, "note", 180);
    const result =
      action === "seedCodeOwnedCatalog"
        ? await fetchMutation(seedCodeOwnedCatalogMutation, withoutUndefined({ note }), { url: deploymentUrl, token })
        : await fetchMutation(
            activateCatalogVersionMutation,
            withoutUndefined({ version: parseVersion(input.version), note }),
            { url: deploymentUrl, token }
          );

    return adminJson({ catalog: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Admin Catalog";
    return adminJson({ error: message }, { status: adminFailureStatus(message) });
  }
}
