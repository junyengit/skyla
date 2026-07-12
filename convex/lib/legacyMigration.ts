export const legacyMigrationKinds = ["bookings", "members", "inquiries"] as const;
export type LegacyMigrationKind = (typeof legacyMigrationKinds)[number];

export type LegacyMigrationInput = {
  legacyId: string;
  createdAt: number;
  raw: Record<string, unknown>;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenMinLength = 32;
const maxRawRecordBytes = 64 * 1024;

export function assertLegacyMigrationAuthorized(providedToken: unknown, configuredToken: unknown) {
  const configured = normalizeToken(configuredToken, "SKYLA_DATA_MIGRATION_TOKEN");
  if (configured.length < tokenMinLength) {
    throw new Error(`SKYLA_DATA_MIGRATION_TOKEN must be at least ${tokenMinLength} characters`);
  }
  const provided = normalizeToken(providedToken, "migrationToken");
  if (!constantTimeTextEqual(provided, configured)) {
    throw new Error("migration token is not authorized");
  }
}

export async function normalizeLegacyBatchIdentity(input: {
  source: unknown;
  batchId: unknown;
  kind: unknown;
  records: LegacyMigrationInput[];
}) {
  const source = normalizeLegacySource(input.source);
  const batchId = requiredText(input.batchId, "batchId", 160);
  if (!/^[A-Za-z0-9:_.-]+$/.test(batchId)) {
    throw new Error("batchId must use URL-safe characters");
  }
  if (!legacyMigrationKinds.includes(input.kind as LegacyMigrationKind)) {
    throw new Error("legacy migration kind is not recognized");
  }
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 50) {
    throw new Error("legacy migration batch must contain 1-50 records");
  }

  const records = input.records.map(normalizeLegacyMigrationInput);
  const expectedIdentityPrefix = `${source}:${input.kind}:`;
  if (records.some((record) => !record.legacyId.startsWith(expectedIdentityPrefix))) {
    throw new Error("legacyId must include the complete source and kind namespace");
  }
  const ids = new Set(records.map((record) => record.legacyId));
  if (ids.size !== records.length) {
    throw new Error("legacy migration batch contains duplicate legacyId values");
  }
  const kind = input.kind as LegacyMigrationKind;
  const inputHash = await stableMigrationHash({ source, kind, records });
  return { source, batchId, kind, records, inputHash };
}

export function normalizeLegacySource(value: unknown) {
  const source = requiredText(value, "source", 100);
  if (!/^supabase:[a-z0-9_-]{6,80}$/.test(source) && !/^localStorage:[A-Za-z0-9_.-]{1,80}$/.test(source)) {
    throw new Error("source must identify the Supabase project or localStorage export");
  }
  return source;
}

export function normalizeLegacyMigrationInput(value: LegacyMigrationInput): LegacyMigrationInput {
  const legacyId = requiredText(value?.legacyId, "legacyId", 240);
  if (!Number.isSafeInteger(value?.createdAt) || value.createdAt < 0) {
    throw new Error(`legacy record ${legacyId} createdAt must be a non-negative timestamp`);
  }
  if (!value.raw || typeof value.raw !== "object" || Array.isArray(value.raw)) {
    throw new Error(`legacy record ${legacyId} raw must be an object`);
  }
  if (new TextEncoder().encode(JSON.stringify(value.raw)).byteLength > maxRawRecordBytes) {
    throw new Error(`legacy record ${legacyId} raw exceeds 64 KiB`);
  }
  return { legacyId, createdAt: value.createdAt, raw: value.raw };
}

export async function normalizeLegacyBooking(input: LegacyMigrationInput, source: string) {
  const raw = input.raw;
  const adults = optionalNonNegativeNumber(raw.adults);
  const children = optionalNonNegativeNumber(raw.children);
  const infants = optionalNonNegativeNumber(raw.infants);
  const explicitPartySize = optionalNonNegativeNumber(raw.partySize) ?? optionalNonNegativeNumber(raw.guests);
  const calculatedPartySize = [adults, children, infants].some((value) => value !== undefined)
    ? (adults ?? 0) + (children ?? 0) + (infants ?? 0)
    : undefined;
  const fingerprint = await legacyRecordFingerprint("bookings", input, source);

  return withoutUndefined({
    bookingRef:
      optionalText(raw.bookingRef, 80) ??
      `LEGACY-${fingerprint.slice("sha256:".length, "sha256:".length + 16).toUpperCase()}`,
    visitDate: optionalText(raw.visitDate, 40),
    entryTime: optionalText(raw.entryTime, 40) ?? optionalText(raw.time, 40),
    partySize: explicitPartySize ?? calculatedPartySize,
    status: optionalText(raw.status, 40) ?? "confirmed",
    emailLower: optionalEmail(raw.emailLower) ?? optionalEmail(raw.email),
    checkedInAt: optionalTimestamp(raw.checkedInAt),
    cancelledAt: optionalTimestamp(raw.cancelledAt),
    createdAt: input.createdAt,
    updatedAt: optionalTimestamp(raw.updatedAt) ?? input.createdAt,
    legacyId: input.legacyId,
    legacySource: source,
    legacyFingerprint: fingerprint,
    rawLegacy: raw
  });
}

export async function normalizeLegacyMember(input: LegacyMigrationInput, source: string) {
  const raw = input.raw;
  const fingerprint = await legacyRecordFingerprint("members", input, source);
  const email = optionalText(raw.email, 254);
  return withoutUndefined({
    status: optionalText(raw.status, 40) ?? "pending",
    firstName: optionalText(raw.firstName, 120),
    lastName: optionalText(raw.lastName, 120),
    email,
    emailLower: optionalEmail(raw.emailLower) ?? optionalEmail(email),
    phone: optionalText(raw.phone, 80),
    tier: optionalText(raw.tier, 80),
    source: optionalText(raw.source, 120),
    bio: optionalText(raw.bio, 2000),
    createdAt: input.createdAt,
    updatedAt: optionalTimestamp(raw.updatedAt) ?? input.createdAt,
    legacyId: input.legacyId,
    legacySource: source,
    legacyFingerprint: fingerprint,
    rawLegacy: raw
  });
}

export async function normalizeLegacyInquiry(input: LegacyMigrationInput, source: string) {
  const raw = input.raw;
  const fingerprint = await legacyRecordFingerprint("inquiries", input, source);
  const email = optionalText(raw.email, 254);
  return withoutUndefined({
    status: optionalText(raw.status, 40) ?? "pending",
    firstName: optionalText(raw.firstName, 120),
    lastName: optionalText(raw.lastName, 120),
    email,
    emailLower: optionalEmail(raw.emailLower) ?? optionalEmail(email),
    experience: optionalText(raw.experience, 120),
    eventDate: optionalText(raw.eventDate, 40) ?? optionalText(raw.date, 40),
    guestCount: optionalScalarText(raw.guestCount, 40) ?? optionalScalarText(raw.guests, 40),
    notes: optionalText(raw.notes, 2000),
    source: optionalText(raw.source, 120),
    createdAt: input.createdAt,
    updatedAt: optionalTimestamp(raw.updatedAt) ?? input.createdAt,
    legacyId: input.legacyId,
    legacySource: source,
    legacyFingerprint: fingerprint,
    rawLegacy: raw
  });
}

export async function legacyRecordFingerprint(kind: LegacyMigrationKind, input: LegacyMigrationInput, source: string) {
  return stableMigrationHash({ kind, source, legacyId: input.legacyId, createdAt: input.createdAt, raw: input.raw });
}

function normalizeToken(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is not configured`);
  }
  if (/\s/.test(value)) {
    throw new Error(`${label} must not contain whitespace`);
  }
  return value.trim();
}

function constantTimeTextEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function optionalEmail(value: unknown) {
  const email = optionalText(value, 254)?.toLowerCase();
  return email && emailPattern.test(email) ? email : undefined;
}

function optionalNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalScalarText(value: unknown, maxLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return optionalText(value, maxLength);
}

function optionalTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function stableMigrationHash(value: unknown) {
  const payload = stableStringify(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
