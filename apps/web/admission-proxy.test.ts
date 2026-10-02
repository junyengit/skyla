import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: vi.fn() }));
import { config } from "./proxy";
describe("admission Clerk middleware coverage", () => {
  it.each(["/admission", "/admission/", "/api/admin/admission/occupancy", "/api/admin/admission/departure", "/staff-sign-in"])("covers %s with the installed Next matcher", url => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
});
