import { fetchQuery } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";
import { adminFailureStatus, authToken, convexUrl } from "../_shared";

export const dynamic = "force-dynamic";

type ExportKind = "bookings" | "members" | "inquiries" | "orders" | "posSales" | "payments";
type StaffRole = "admin" | "pos" | "viewer";
type ExportRow = Record<string, unknown>;

type AdminExportRowsArgs = {
  kind: ExportKind;
  limit?: number;
};

type AdminExportRowsResult = {
  staff: {
    emailLower: string;
    role: StaffRole;
  };
  kind: ExportKind;
  generatedAt: number;
  limit: number;
  rows: ExportRow[];
};

type ExportColumn = {
  header: string;
  value: (row: ExportRow) => unknown;
};

const exportLimit = 250;
const exportKinds = ["bookings", "members", "inquiries", "orders", "posSales", "payments"] as const;
const exportKindSet = new Set<ExportKind>(exportKinds);

const getAdminExportRowsQuery = makeFunctionReference<"query", AdminExportRowsArgs, AdminExportRowsResult>(
  "admin:getAdminExportRows"
);

function field(key: string) {
  return (row: ExportRow) => row[key];
}

function nested(row: ExportRow, ...keys: string[]) {
  let value: unknown = row;
  for (const key of keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function timestamp(key: string) {
  return (row: ExportRow) => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
  };
}

const exportColumns: Record<ExportKind, ExportColumn[]> = {
  bookings: [
    { header: "booking_ref", value: field("bookingRef") },
    { header: "order_ref", value: field("orderRef") },
    { header: "status", value: field("status") },
    { header: "visit_date", value: field("visitDate") },
    { header: "entry_time", value: field("entryTime") },
    { header: "email", value: field("emailLower") },
    { header: "first_name", value: field("firstName") },
    { header: "last_name", value: field("lastName") },
    { header: "party_size", value: field("partySize") },
    { header: "voucher_total", value: (row) => nested(row, "vouchers", "summary", "total") },
    { header: "voucher_redeemed", value: (row) => nested(row, "vouchers", "summary", "redeemed") },
    { header: "voucher_remaining", value: (row) => nested(row, "vouchers", "summary", "remaining") },
    { header: "checked_in_at", value: timestamp("checkedInAt") },
    { header: "cancelled_at", value: timestamp("cancelledAt") },
    { header: "created_at", value: timestamp("createdAt") },
    { header: "updated_at", value: timestamp("updatedAt") },
    { header: "legacy_id", value: field("legacyId") }
  ],
  members: [
    { header: "member_id", value: field("memberId") },
    { header: "status", value: field("status") },
    { header: "email", value: field("email") },
    { header: "email_lower", value: field("emailLower") },
    { header: "first_name", value: field("firstName") },
    { header: "last_name", value: field("lastName") },
    { header: "phone", value: field("phone") },
    { header: "tier", value: field("tier") },
    { header: "source", value: field("source") },
    { header: "created_at", value: timestamp("createdAt") },
    { header: "updated_at", value: timestamp("updatedAt") },
    { header: "legacy_id", value: field("legacyId") }
  ],
  inquiries: [
    { header: "inquiry_id", value: field("inquiryId") },
    { header: "status", value: field("status") },
    { header: "email", value: field("email") },
    { header: "email_lower", value: field("emailLower") },
    { header: "first_name", value: field("firstName") },
    { header: "last_name", value: field("lastName") },
    { header: "experience", value: field("experience") },
    { header: "event_date", value: field("eventDate") },
    { header: "guest_count", value: field("guestCount") },
    { header: "notes", value: field("notes") },
    { header: "source", value: field("source") },
    { header: "created_at", value: timestamp("createdAt") },
    { header: "updated_at", value: timestamp("updatedAt") },
    { header: "legacy_id", value: field("legacyId") }
  ],
  orders: [
    { header: "order_ref", value: field("orderRef") },
    { header: "channel", value: field("channel") },
    { header: "status", value: field("status") },
    { header: "total_cents", value: field("totalCents") },
    { header: "currency", value: field("currency") },
    { header: "expected_provider", value: field("expectedProvider") },
    { header: "customer_email", value: field("customerEmailLower") },
    { header: "visit_date", value: field("visitDate") },
    { header: "entry_time", value: field("entryTime") },
    { header: "created_at", value: timestamp("createdAt") },
    { header: "updated_at", value: timestamp("updatedAt") }
  ],
  posSales: [
    { header: "sale_ref", value: field("saleRef") },
    { header: "status", value: field("status") },
    { header: "total_cents", value: field("totalCents") },
    { header: "currency", value: field("currency") },
    { header: "customer_email", value: field("customerEmailLower") },
    { header: "reader_id_masked", value: (row) => maskedIdentifier(row.readerId) },
    { header: "terminal_location_id_masked", value: (row) => maskedIdentifier(row.terminalLocationId) },
    { header: "created_at", value: timestamp("createdAt") },
    { header: "updated_at", value: timestamp("updatedAt") }
  ],
  payments: [
    { header: "provider", value: field("provider") },
    { header: "provider_payment_id_masked", value: (row) => maskedIdentifier(row.providerPaymentId) },
    { header: "status", value: field("status") },
    { header: "amount_cents", value: field("amountCents") },
    { header: "currency", value: field("currency") },
    { header: "order_ref", value: field("orderRef") },
    { header: "sale_ref", value: field("saleRef") },
    { header: "raw_event_id_masked", value: (row) => maskedIdentifier(row.rawEventId) },
    { header: "created_at", value: timestamp("createdAt") }
  ]
};

function parseKind(value: string | null) {
  if (!value || !exportKindSet.has(value as ExportKind)) {
    throw new Error(`kind must be one of: ${exportKinds.join(", ")}`);
  }
  return value as ExportKind;
}

function parseLimit(value: string | null) {
  if (!value) {
    return exportLimit;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > exportLimit) {
    throw new Error(`limit must be an integer between 1 and ${exportLimit}`);
  }
  return limit;
}

function parseFormat(value: string | null) {
  if (!value || value === "csv") {
    return "csv";
  }
  throw new Error("format must be csv");
}

function csvCell(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  const safeText = /^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replaceAll('"', '""')}"` : safeText;
}

function toCsv(kind: ExportKind, rows: ExportRow[]) {
  const columns = exportColumns[kind];
  return [
    columns.map((column) => csvCell(column.header)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(","))
  ].join("\n");
}

function exportFilename(kind: ExportKind, generatedAt: number) {
  const date = new Date(generatedAt).toISOString().slice(0, 10);
  return `skyla-${kind}-${date}.csv`;
}

function maskedIdentifier(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const text = value.trim();
  if (text.length <= 8) {
    return `${text.slice(0, 2)}...`;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function noStoreHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("cache-control", "no-store");
  result.set("vary", "Authorization");
  return result;
}

function jsonError(error: string, status: number, code?: string) {
  return Response.json(code ? { error, code } : { error }, {
    status,
    headers: noStoreHeaders()
  });
}

export async function GET(request: Request) {
  try {
    const token = authToken(request);
    if (!token) {
      return jsonError("Staff authentication is required for Admin Export", 401, "staff_auth_required");
    }

    const searchParams = new URL(request.url).searchParams;
    const kind = parseKind(searchParams.get("kind"));
    const limit = parseLimit(searchParams.get("limit"));
    parseFormat(searchParams.get("format"));

    const deploymentUrl = convexUrl();
    if (!deploymentUrl) {
      return jsonError("Convex is not configured for Admin Export", 503, "convex_unconfigured");
    }

    const exportRows = await fetchQuery(getAdminExportRowsQuery, { kind, limit }, { url: deploymentUrl, token });
    const generatedAtIso = new Date(exportRows.generatedAt).toISOString();

    return new Response(toCsv(exportRows.kind, exportRows.rows), {
      status: 200,
      headers: noStoreHeaders({
        "content-disposition": `attachment; filename="${exportFilename(exportRows.kind, exportRows.generatedAt)}"`,
        "content-type": "text/csv; charset=utf-8",
        "x-skyla-export-generated-at": generatedAtIso,
        "x-skyla-export-kind": exportRows.kind
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export Admin data";
    return jsonError(message, adminFailureStatus(message));
  }
}
