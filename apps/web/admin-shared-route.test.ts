import { describe, expect, it } from "vitest";

import { adminJson, convexUnconfiguredResponse, staffAuthRequiredResponse } from "./app/api/admin/_shared";

function expectStaffApiHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("vary")?.toLowerCase().split(",").map((item) => item.trim())).toContain("authorization");
}

describe("admin API shared responses", () => {
  it("marks staff JSON responses as private to each Authorization header", async () => {
    const response = adminJson({ ok: true });

    expect(response.status).toBe(200);
    expectStaffApiHeaders(response);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("keeps auth and configuration failures out of shared caches", async () => {
    const authResponse = staffAuthRequiredResponse("Admin Test");
    const configResponse = convexUnconfiguredResponse("Admin Test");

    expect(authResponse.status).toBe(401);
    expect(configResponse.status).toBe(503);
    expectStaffApiHeaders(authResponse);
    expectStaffApiHeaders(configResponse);
  });
});
