export type ClientErrorSource = "error-boundary" | "global-error-boundary";

export const clientErrorLimits = {
  message: 500,
  digest: 100,
  path: 200
} as const;

// Best-effort telemetry: reporting must never throw or add a second failure on
// top of the one being reported, so every failure path here is swallowed.
export function reportClientError(error: unknown, source: ClientErrorSource) {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const rawDigest = error instanceof Error ? (error as { digest?: unknown }).digest : undefined;
    const digest = typeof rawDigest === "string" ? rawDigest : undefined;
    const body = JSON.stringify({
      source,
      message: message.slice(0, clientErrorLimits.message),
      digest: digest?.slice(0, clientErrorLimits.digest),
      path: window.location.pathname.slice(0, clientErrorLimits.path)
    });
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true
    }).catch(() => undefined);
  } catch {
    // Reporting is fire-and-forget by design.
  }
}
