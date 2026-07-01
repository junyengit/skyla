export type TerminalReaderSelection = {
  readerId?: string;
  terminalLocationId?: string;
};

type TerminalReaderRecord = {
  readerId: string;
  terminalLocationId?: string;
};

const readerPattern = /^tmr_[A-Za-z0-9_]+$/;
const locationPattern = /^tml_[A-Za-z0-9_]+$/;

export function authorizeTerminalReaderSelection(
  selection: TerminalReaderSelection,
  registryValue: string | undefined
): TerminalReaderSelection {
  const readerId = normalizedId(selection.readerId, "readerId", readerPattern, "tmr_");
  const terminalLocationId = normalizedId(
    selection.terminalLocationId,
    "terminalLocationId",
    locationPattern,
    "tml_"
  );

  if (!readerId && !terminalLocationId) {
    return {};
  }
  if (!readerId) {
    throw new Error("Terminal reader is required before storing a Terminal location");
  }

  const registry = parseTerminalReaderRegistry(registryValue);
  if (registry.length === 0) {
    throw new Error("Trusted Terminal reader registry is not configured");
  }

  const authorized = registry.find((record) => record.readerId === readerId);
  if (!authorized) {
    throw new Error("Terminal reader is not authorized for POS payments");
  }
  if (authorized.terminalLocationId && terminalLocationId && authorized.terminalLocationId !== terminalLocationId) {
    throw new Error("Terminal location does not match the authorized reader");
  }
  if (!authorized.terminalLocationId && terminalLocationId) {
    throw new Error("Terminal location must be configured in the trusted reader registry");
  }

  return withoutUndefined({
    readerId: authorized.readerId,
    terminalLocationId: authorized.terminalLocationId
  });
}

export function parseTerminalReaderRegistry(value: string | undefined): TerminalReaderRecord[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseTerminalReaderEntry);
}

function parseTerminalReaderEntry(entry: string): TerminalReaderRecord {
  const [readerId, terminalLocationId, extra] = entry.split("@").map((part) => part.trim());
  if (!readerId || extra !== undefined) {
    throw new Error("Trusted Terminal reader registry entries must use readerId@locationId");
  }
  const authorizedReaderId = normalizedId(readerId, "readerId", readerPattern, "tmr_");
  if (!authorizedReaderId) {
    throw new Error("Trusted Terminal reader registry entries must include a readerId");
  }

  return withoutUndefined({
    readerId: authorizedReaderId,
    terminalLocationId: normalizedId(terminalLocationId || undefined, "terminalLocationId", locationPattern, "tml_")
  });
}

function normalizedId(value: string | undefined, label: string, pattern: RegExp, prefix: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!pattern.test(trimmed)) {
    throw new Error(`${label} must look like ${prefix}...`);
  }
  return trimmed;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
