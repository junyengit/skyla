import { createPosSaleDraft, cafeItems, ticketPackages, type PosSaleInput } from "@skyla/payments";
import { fetchMutation } from "convex/nextjs";
import { makeFunctionReference } from "convex/server";

type PosDraftInput = {
  lines?: unknown;
  customerEmail?: unknown;
  idempotencyKey?: unknown;
};

type PosDraftMutationArgs = {
  lines: PosSaleInput["lines"];
  customerEmail?: string;
  idempotencyKey: string;
};

type PersistedPosDraftResult = {
  saleRef: string;
  status: "draft";
  totals: {
    currency: "usd";
    subtotalCents: number;
    feeCents: number;
    totalCents: number;
  };
  customerEmail?: string;
  readerId?: string;
  terminalLocationId?: string;
  lines: ReturnType<typeof createPosSaleDraft>["lines"];
};

const createPosSaleDraftMutation = makeFunctionReference<
  "mutation",
  PosDraftMutationArgs,
  PersistedPosDraftResult
>("orderDrafts:createPosSaleDraft");

const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{12,96}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = authorization.slice("bearer ".length).trim();
  return token || undefined;
}

function toDraftResponse(result: PersistedPosDraftResult) {
  return {
    channel: "pos" as const,
    status: result.status,
    currency: result.totals.currency,
    subtotalCents: result.totals.subtotalCents,
    feeCents: result.totals.feeCents,
    totalCents: result.totals.totalCents,
    lines: result.lines,
    customerEmail: result.customerEmail,
    readerId: result.readerId,
    terminalLocationId: result.terminalLocationId,
    saleRef: result.saleRef
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integerRange(value: unknown, label: string, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function optionalTrimmed(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function normalizeEmail(value: unknown) {
  const email = optionalTrimmed(value, "customerEmail", 254)?.toLowerCase();
  if (email && !emailPattern.test(email)) {
    throw new Error("customerEmail must be a valid email address");
  }
  return email;
}

function normalizeIdempotencyKey(value: unknown) {
  const key = optionalTrimmed(value, "idempotencyKey", 96);
  if (key && !idempotencyKeyPattern.test(key)) {
    throw new Error("idempotencyKey must be 12-96 URL-safe characters");
  }
  return key;
}

function normalizePosLine(value: unknown): PosSaleInput["lines"][number] {
  const line = assertObject(value, "line");
  const kind = line.kind;
  const quantity = integerRange(line.quantity ?? 1, "line quantity", 1, 99);

  if (kind === "ticket") {
    const packageKey = optionalTrimmed(line.packageKey, "packageKey", 80);
    if (!packageKey || !(packageKey in ticketPackages)) {
      throw new Error("packageKey is not recognized");
    }
    return { kind, packageKey: packageKey as keyof typeof ticketPackages, quantity };
  }

  if (kind === "cafe") {
    const itemKey = optionalTrimmed(line.itemKey, "itemKey", 80);
    if (!itemKey || !(itemKey in cafeItems)) {
      throw new Error("itemKey is not recognized");
    }
    return { kind, itemKey: itemKey as keyof typeof cafeItems, quantity };
  }

  if (kind === "custom") {
    const amountCents = integerRange(line.amountCents, "custom amountCents", 50, 100000);
    const name = optionalTrimmed(line.name, "custom name", 80) ?? "Custom charge";
    const reason = optionalTrimmed(line.reason, "custom reason", 160);
    if (!reason) {
      throw new Error("Custom charge requires a reason");
    }
    return { kind, name, amountCents, quantity, reason };
  }

  throw new Error("line kind is not recognized");
}

function normalizeInput(input: PosDraftInput) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("POS sale requires at least one line");
  }
  if (input.lines.length > 100) {
    throw new Error("POS sale can include at most 100 lines");
  }

    return withoutUndefined({
      lines: input.lines.map(normalizePosLine),
      customerEmail: normalizeEmail(input.customerEmail),
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey)
    });
}

function persistenceFailureStatus(message: string) {
  if (message.includes("different draft")) {
    return 409;
  }
  if (message.includes("idempotencyKey must") || message.includes("must be")) {
    return 400;
  }
  if (message.toLowerCase().includes("auth")) {
    return 401;
  }
  return 502;
}

export async function POST(request: Request) {
  try {
    const input = normalizeInput((await request.json()) as PosDraftInput);
    const draft = createPosSaleDraft({
      actorRole: "pos",
      lines: input.lines,
      customerEmail: input.customerEmail
    });
    const deploymentUrl = convexUrl();
    const token = authToken(request);

    if (deploymentUrl && input.idempotencyKey && token) {
      try {
        const result = await fetchMutation(
          createPosSaleDraftMutation,
          withoutUndefined({
            lines: input.lines,
            customerEmail: input.customerEmail,
            idempotencyKey: input.idempotencyKey
          }),
          { url: deploymentUrl, token }
        );

        return Response.json({
          draft: toDraftResponse(result),
          saleRef: result.saleRef,
          persisted: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not persist POS sale draft";
        return Response.json({ error: message, persisted: false }, { status: persistenceFailureStatus(message) });
      }
    }

    return Response.json({
      draft,
      persisted: false,
      persistenceReason: !deploymentUrl
        ? "convex_unconfigured"
        : !input.idempotencyKey
          ? "idempotencyKey_required"
          : "staff_auth_required"
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create POS sale draft" },
      { status: 400 }
    );
  }
}
