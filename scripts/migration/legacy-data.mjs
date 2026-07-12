import { createHash } from "node:crypto";

export const migrationKinds = ["bookings", "members", "inquiries"];
const maxRawRecordBytes = 64 * 1024;

export function prepareLegacyExport(payload, { source, exportedAt, batchSize = 25, inputHash = sha256(payload) }) {
  if (!/^supabase:[a-z0-9_-]{6,80}$/.test(source) && !/^localStorage:[A-Za-z0-9_.-]{1,80}$/.test(source)) {
    throw new Error("source must identify the Supabase project or localStorage export");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new Error("batchSize must be an integer from 1 to 50");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("legacy export must be a JSON object containing bookings, members, and/or inquiries arrays");
  }
  const normalizedExportedAt = normalizeExportedAt(exportedAt);

  const accepted = Object.fromEntries(migrationKinds.map((kind) => [kind, []]));
  const rejected = [];
  const seen = new Set();

  for (const kind of migrationKinds) {
    const rows = tableRows(payload, kind);
    for (const [index, row] of rows.entries()) {
      try {
        const record = normalizeExportRow(kind, row, source);
        const identity = `${kind}:${record.legacyId}`;
        if (seen.has(identity)) throw new Error("duplicate source row id");
        seen.add(identity);
        accepted[kind].push(record);
      } catch (error) {
        rejected.push({
          kind,
          row: index + 1,
          sourceId: sourceId(row),
          reason: error instanceof Error ? error.message : "row is invalid",
          raw: row
        });
      }
    }
  }

  const batches = [];
  for (const kind of migrationKinds) {
    for (let offset = 0; offset < accepted[kind].length; offset += batchSize) {
      const records = accepted[kind].slice(offset, offset + batchSize);
      const batchNumber = String(offset / batchSize + 1).padStart(4, "0");
      const contentHash = sha256({ source, kind, records });
      batches.push({
        source,
        kind,
        batchId: `skyla-legacy:${kind}:${batchNumber}:${contentHash.slice(7, 19)}`,
        records,
        contentHash
      });
    }
  }

  const counts = Object.fromEntries(migrationKinds.map((kind) => [kind, accepted[kind].length]));
  const acceptedCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const planHash = sha256(batches.map(({ batchId, contentHash }) => ({ batchId, contentHash })));
  return {
    manifest: {
      formatVersion: 1,
      source,
      exportedAt: normalizedExportedAt,
      inputHash,
      planHash,
      counts,
      sourceCount: acceptedCount + rejected.length,
      acceptedCount,
      rejectedCount: rejected.length,
      batchCount: batches.length,
      batchSize,
      batches: batches.map(({ batchId, kind, contentHash, records }) => ({
        batchId,
        kind,
        inputHash: contentHash,
        recordCount: records.length
      }))
    },
    batches,
    rejected
  };
}

export function sha256(value) {
  const payload = typeof value === "string" ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function tableRows(payload, kind) {
  const candidates = [kind, `skyla_${kind}`];
  const found = candidates.find((key) => payload[key] !== undefined);
  if (!found) return [];
  if (!Array.isArray(payload[found])) throw new Error(`${found} must be an array`);
  return payload[found];
}

function normalizeExportRow(kind, row, source) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("row must be an object");
  const raw = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : row;
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > maxRawRecordBytes) {
    throw new Error("raw record exceeds 64 KiB");
  }
  const id = sourceId(row) ?? sourceId(raw);
  if (!id) throw new Error("row id is required");
  const createdAt = timestamp(row.created_at ?? raw.createdAt ?? raw.created_at);
  if (createdAt === undefined) throw new Error("created_at or data.createdAt is required");
  return {
    legacyId: `${source}:${kind}:${id}`,
    createdAt,
    raw
  };
}

function normalizeExportedAt(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("exportedAt must be an ISO-8601 timestamp");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("exportedAt must be an ISO-8601 timestamp");
  return new Date(parsed).toISOString();
}

function sourceId(value) {
  const candidate = value && typeof value === "object" ? value.id : undefined;
  if ((typeof candidate !== "string" && typeof candidate !== "number") || !String(candidate).trim()) return undefined;
  const normalized = String(candidate).trim();
  return normalized.length <= 120 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : undefined;
}

function timestamp(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
