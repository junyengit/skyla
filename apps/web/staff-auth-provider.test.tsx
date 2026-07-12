// @vitest-environment happy-dom

import { createElement, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: true,
    sessionClaims: { aud: "convex" } as { aud?: string },
    getToken: vi.fn()
  },
  signOut: vi.fn(),
  user: {
    id: "user_admin",
    primaryEmailAddress: { emailAddress: "admin@skydeckla.com" }
  } as { id: string; primaryEmailAddress: { emailAddress: string } } | null
}));

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => clerk.auth,
  useClerk: () => ({ signOut: clerk.signOut }),
  useUser: () => ({ user: clerk.user })
}));

import { StaffAuthProvider, useStaffSession } from "./components/staff-auth-provider";

function SessionProbe({ requestUrl }: { requestUrl: string }) {
  const session = useStaffSession();
  const [sensitiveValue, setSensitiveValue] = useState("");
  const [requestError, setRequestError] = useState("");
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "status" }, session.status),
    createElement("span", { "data-testid": "sensitive" }, sensitiveValue),
    createElement(
      "button",
      { type: "button", onClick: () => setSensitiveValue("booking@example.com") },
      "Load sensitive state"
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          void session.staffFetch(requestUrl).catch((error: unknown) => {
            setRequestError(error instanceof Error ? error.message : "Request failed");
          });
        }
      },
      "Run staff request"
    ),
    createElement(
      "button",
      { type: "button", onClick: () => void session.signOut() },
      "Sign out"
    ),
    createElement("span", { "data-testid": "request-error" }, requestError)
  );
}

function app(requestUrl = "/api/admin/operations") {
  return createElement(
    StaffAuthProvider,
    { enabled: true },
    createElement(SessionProbe, { requestUrl })
  );
}

describe("StaffAuthProvider", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_staff";
    clerk.auth.isLoaded = true;
    clerk.auth.isSignedIn = true;
    clerk.auth.sessionClaims = { aud: "convex" };
    clerk.auth.getToken.mockReset().mockResolvedValue("short-lived-token");
    clerk.signOut.mockReset().mockResolvedValue(undefined);
    clerk.user = {
      id: "user_admin",
      primaryEmailAddress: { emailAddress: "admin@skydeckla.com" }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    vi.unstubAllGlobals();
  });

  it("remounts staff children and clears sensitive state when the identity signs out", () => {
    const view = render(app());
    fireEvent.click(screen.getByRole("button", { name: "Load sensitive state" }));
    expect(screen.getByTestId("sensitive").textContent).toBe("booking@example.com");

    clerk.auth.isSignedIn = false;
    clerk.user = null;
    view.rerender(app());

    expect(screen.getByTestId("status").textContent).toBe("signed-out");
    expect(screen.getByTestId("sensitive").textContent).toBe("");
  });

  it("invalidates an in-flight token before it can be sent after sign-out", async () => {
    let resolveToken: (token: string) => void = () => {};
    clerk.auth.getToken.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    const view = render(app());
    fireEvent.click(screen.getByRole("button", { name: "Run staff request" }));

    clerk.auth.isSignedIn = false;
    clerk.user = null;
    view.rerender(app());
    await act(async () => resolveToken("late-token"));

    expect(clerk.auth.getToken).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates a token synchronously before Clerk sign-out finishes", async () => {
    let resolveToken: (token: string) => void = () => {};
    let resolveSignOut: () => void = () => {};
    clerk.auth.getToken.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveToken = resolve;
    }));
    clerk.signOut.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSignOut = resolve;
    }));
    render(app());
    fireEvent.click(screen.getByRole("button", { name: "Run staff request" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await act(async () => resolveToken("late-token"));
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => resolveSignOut());
  });

  it("refuses cross-origin destinations before requesting a token", async () => {
    render(app("https://example.com/api/admin/operations"));
    fireEvent.click(screen.getByRole("button", { name: "Run staff request" }));

    await waitFor(() => {
      expect(screen.getByTestId("request-error").textContent).toContain("approved Skyla API route");
    });
    expect(clerk.auth.getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
