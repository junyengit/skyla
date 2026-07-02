export const staffBootstrapRoles = ["admin", "pos", "viewer"] as const;

export type StaffBootstrapRole = (typeof staffBootstrapRoles)[number];

export type NormalizedStaffBootstrapInput = {
  subject: string;
  emailLower: string;
  role: StaffBootstrapRole;
  active: boolean;
  note?: string;
};

const minBootstrapTokenLength = 32;
const maxSubjectLength = 240;
const maxNoteLength = 160;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertStaffBootstrapAuthorized(providedToken: unknown, configuredToken: unknown) {
  const configured = normalizeSecret(configuredToken, "SKYLA_STAFF_BOOTSTRAP_TOKEN");
  if (configured.length < minBootstrapTokenLength) {
    throw new Error(`SKYLA_STAFF_BOOTSTRAP_TOKEN must be at least ${minBootstrapTokenLength} characters`);
  }

  const provided = normalizeSecret(providedToken, "bootstrapToken");
  if (provided !== configured) {
    throw new Error("bootstrap token is not authorized");
  }
}

export function normalizeStaffBootstrapInput(input: {
  subject?: unknown;
  email?: unknown;
  role?: unknown;
  active?: unknown;
  note?: unknown;
}): NormalizedStaffBootstrapInput {
  return {
    subject: normalizeSubject(input.subject),
    emailLower: normalizeEmail(input.email),
    role: normalizeRole(input.role),
    active: input.active === undefined ? true : normalizeBoolean(input.active, "active"),
    note: normalizeOptionalNote(input.note)
  };
}

export function staffBootstrapAuditMetadata(input: NormalizedStaffBootstrapInput, created: boolean) {
  const metadata: Record<string, string | boolean> = {
    emailLower: input.emailLower,
    role: input.role,
    active: input.active,
    created
  };
  if (input.note) {
    metadata.note = input.note;
  }
  return metadata;
}

function normalizeSecret(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is not configured`);
  }
  if (/\s/.test(value)) {
    throw new Error(`${label} must not contain whitespace`);
  }
  return value.trim();
}

function normalizeSubject(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("subject is required");
  }
  const subject = value.trim();
  if (subject.length > maxSubjectLength) {
    throw new Error(`subject must be ${maxSubjectLength} characters or fewer`);
  }
  if (/[\u0000-\u001f\u007f]/.test(subject)) {
    throw new Error("subject must not contain control characters");
  }
  return subject;
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("email is required");
  }
  const email = value.trim().toLowerCase();
  if (!emailPattern.test(email)) {
    throw new Error("email must be a valid email address");
  }
  return email;
}

function normalizeRole(value: unknown) {
  if (!staffBootstrapRoles.includes(value as StaffBootstrapRole)) {
    throw new Error("staff role is not recognized");
  }
  return value as StaffBootstrapRole;
}

function normalizeBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function normalizeOptionalNote(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("note must be a string");
  }
  const note = value.trim();
  if (!note) {
    return undefined;
  }
  if (note.length > maxNoteLength) {
    throw new Error(`note must be ${maxNoteLength} characters or fewer`);
  }
  return note;
}
