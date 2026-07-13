import { createHmac } from "node:crypto";

export type PublicGatewayOperation =
  | "experience-inquiry"
  | "member-application"
  | "checkout-draft"
  | "stripe-checkout";

type GatewayErrorBody = {
  ok?: unknown;
  code?: unknown;
  error?: unknown;
  retryAfterSeconds?: unknown;
};

export class PublicGatewayError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: { code: string; status: number; retryAfterSeconds?: number }) {
    super(message);
    this.name = "PublicGatewayError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export async function callPublicConvexGateway<Result>(
  request: Request,
  operation: PublicGatewayOperation,
  input: Record<string, unknown>
): Promise<Result> {
  const secret = publicGatewaySecret();
  const siteUrl = convexSiteUrl();
  const clientAddress = trustedClientAddress(request);
  const rateLimitKey = hmacHex(secret, `${operation}\n${clientAddress}`);

  let response: Response;
  try {
    response = await fetch(`${siteUrl}/public-gateway`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ operation, rateLimitKey, input }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw new PublicGatewayError("The service is temporarily unavailable", {
      code: "public_gateway_unavailable",
      status: 503
    });
  }

  const body = await safeJson(response);
  if (!response.ok) {
    const retryAfterSeconds = positiveInteger(body.retryAfterSeconds);
    throw new PublicGatewayError(publicErrorMessage(body, response.status), {
      code: typeof body.code === "string" ? body.code : "public_gateway_error",
      status: publicGatewayStatus(response.status),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {})
    });
  }

  if (!body || body.ok !== true || !("result" in body)) {
    throw new PublicGatewayError("The service returned an invalid response", {
      code: "public_gateway_invalid_response",
      status: 502
    });
  }
  return body.result as Result;
}

export function publicGatewayErrorResponse(error: unknown, fallbackMessage: string) {
  const gatewayError = error instanceof PublicGatewayError
    ? error
    : new PublicGatewayError(fallbackMessage, { code: "public_gateway_error", status: 502 });
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (gatewayError.retryAfterSeconds) {
    headers.set("Retry-After", String(gatewayError.retryAfterSeconds));
  }
  return Response.json(
    {
      error: gatewayError.status >= 500 ? fallbackMessage : gatewayError.message,
      code: gatewayError.code,
      ...(gatewayError.retryAfterSeconds
        ? { retryAfterSeconds: gatewayError.retryAfterSeconds }
        : {})
    },
    { status: gatewayError.status, headers }
  );
}

export function convexSiteUrl() {
  const configured = envValue(process.env.CONVEX_SITE_URL);
  if (configured) {
    return validSiteOrigin(configured);
  }

  const deploymentUrl = envValue(process.env.CONVEX_URL) ?? envValue(process.env.NEXT_PUBLIC_CONVEX_URL);
  if (!deploymentUrl) {
    throw gatewayConfigurationError();
  }
  const url = new URL(deploymentUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud") || url.pathname !== "/") {
    throw gatewayConfigurationError();
  }
  url.hostname = `${url.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
  return url.origin;
}

export function trustedClientAddress(request: Request) {
  const vercelAddress = normalizedAddress(request.headers.get("x-vercel-forwarded-for"));
  if (vercelAddress) {
    return vercelAddress;
  }
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
    throw new PublicGatewayError("The service cannot verify this request", {
      code: "trusted_client_address_unavailable",
      status: 503
    });
  }

  return normalizedAddress(request.headers.get("x-forwarded-for")) ?? "local-development";
}

function hmacHex(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function publicGatewaySecret() {
  const secret = envValue(process.env.SKYLA_PUBLIC_GATEWAY_SECRET);
  if (!secret || secret.length < 32 || secret.length > 256 || /\s/.test(secret)) {
    throw gatewayConfigurationError();
  }
  return secret;
}

function envValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "undefined" && normalized !== "null" ? normalized : undefined;
}

function validSiteOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw gatewayConfigurationError();
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const convexCloudSite =
    url.protocol === "https:" &&
    url.hostname.length > ".convex.site".length &&
    url.hostname.endsWith(".convex.site");
  if (
    (!convexCloudSite && !(localDevelopment && ["http:", "https:"].includes(url.protocol))) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw gatewayConfigurationError();
  }
  return url.origin;
}

function normalizedAddress(value: string | null) {
  const address = value?.split(",")[0]?.trim();
  if (!address || address.length > 64 || !/^[0-9a-f:.]+$/i.test(address)) {
    return null;
  }
  return address.toLowerCase();
}

function gatewayConfigurationError() {
  return new PublicGatewayError("The public server gateway is not configured", {
    code: "public_gateway_unconfigured",
    status: 503
  });
}

async function safeJson(response: Response): Promise<GatewayErrorBody & { result?: unknown }> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as GatewayErrorBody & { result?: unknown } : {};
  } catch {
    return {};
  }
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;
}

function publicErrorMessage(body: GatewayErrorBody, status: number) {
  if (typeof body.error === "string" && status < 500) {
    return body.error;
  }
  return status === 429 ? "Too many requests. Please try again later." : "The service is temporarily unavailable";
}

function publicGatewayStatus(status: number) {
  return [400, 401, 409, 413, 429, 502, 503].includes(status) ? status : 502;
}
