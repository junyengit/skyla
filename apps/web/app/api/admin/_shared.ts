export function convexUrl() {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
}

export function authToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = authorization.slice("bearer ".length).trim();
  return token || undefined;
}

export function requiredString(value: unknown, label: string, maxLength = 160) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

export function optionalString(value: unknown, label: string, maxLength = 160) {
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

export function adminFailureStatus(message: string) {
  const normalized = message.toLowerCase();
  if (
    message.includes("is required") ||
    message.includes("must be") ||
    normalized.includes("not recognized") ||
    normalized.includes("does not match validator")
  ) {
    return 400;
  }
  if (normalized.includes("auth")) {
    return 401;
  }
  if (normalized.includes("staff role") || normalized.includes("only admin")) {
    return 403;
  }
  if (normalized.includes("not configured")) {
    return 503;
  }
  if (normalized.includes("not found")) {
    return 404;
  }
  if (normalized.includes("cancelled bookings cannot")) {
    return 409;
  }
  return 502;
}

export function staffAuthRequiredResponse(label: string) {
  return Response.json(
    {
      error: `Staff authentication is required for ${label}`,
      code: "staff_auth_required"
    },
    { status: 401 }
  );
}

export function convexUnconfiguredResponse(label: string) {
  return Response.json(
    {
      error: `Convex is not configured for ${label}`,
      code: "convex_unconfigured"
    },
    { status: 503 }
  );
}
