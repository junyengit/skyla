export const dynamic = "force-dynamic";

const maxBodyBytes = 4096;
const limits = { message: 500, digest: 100, path: 200 } as const;
const allowedSources = new Set(["error-boundary", "global-error-boundary"]);

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

// Accepts sanitized crash reports from the React error boundaries and writes
// them to server logs so Vercel runtime log review can see client-side
// failures. The response is always an empty 204: this endpoint must never leak
// validation detail or become a probing surface.
export async function POST(request: Request) {
  try {
    const declaredBytes = Number(request.headers.get("content-length") ?? "0");
    const raw = declaredBytes > maxBodyBytes ? "" : await request.text();
    if (raw.length > 0 && raw.length <= maxBodyBytes) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const source = boundedString(record.source, 40);
        const message = boundedString(record.message, limits.message);
        if (source && allowedSources.has(source) && message) {
          console.error(
            "[client-error]",
            JSON.stringify({
              source,
              message,
              digest: boundedString(record.digest, limits.digest) ?? undefined,
              path: boundedString(record.path, limits.path) ?? undefined
            })
          );
        }
      }
    }
  } catch {
    // Malformed reports are dropped without feedback.
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" }
  });
}
