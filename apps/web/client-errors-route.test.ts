import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./app/api/client-errors/route";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function request(body: string) {
  return new Request("http://localhost/api/client-errors", {
    method: "POST",
    body
  });
}

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("/api/client-errors", () => {
  it("logs a sanitized report server-side and returns an empty 204", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          source: "error-boundary",
          message: "Something exploded",
          digest: "digest123",
          path: "/checkout"
        })
      )
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [prefix, payload] = consoleErrorSpy.mock.calls[0] as [string, string];
    expect(prefix).toBe("[client-error]");
    expect(JSON.parse(payload)).toEqual({
      source: "error-boundary",
      message: "Something exploded",
      digest: "digest123",
      path: "/checkout"
    });
  });

  it("truncates oversized report fields instead of trusting browser input", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          source: "global-error-boundary",
          message: "m".repeat(900),
          digest: "d".repeat(300),
          path: `/${"p".repeat(300)}`
        })
      )
    );

    expect(response.status).toBe(204);
    const [, payload] = consoleErrorSpy.mock.calls[0] as [string, string];
    const logged = JSON.parse(payload) as { message: string; digest: string; path: string };
    expect(logged.message).toHaveLength(500);
    expect(logged.digest).toHaveLength(100);
    expect(logged.path).toHaveLength(200);
  });

  it("drops bodies above the size cap without logging or feedback", async () => {
    const response = await POST(
      request(JSON.stringify({ source: "error-boundary", message: "x".repeat(5000) }))
    );

    expect(response.status).toBe(204);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["array body", JSON.stringify(["error-boundary"])],
    ["unknown source", JSON.stringify({ source: "spoofed", message: "hi" })],
    ["missing message", JSON.stringify({ source: "error-boundary" })]
  ])("drops invalid reports without logging: %s", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
