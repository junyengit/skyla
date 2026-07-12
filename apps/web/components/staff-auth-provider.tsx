"use client";

import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/nextjs";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { approvedStaffApiUrl } from "@/lib/staff-api-url";

type StaffSessionStatus = "unconfigured" | "loading" | "signed-out" | "signed-in" | "signing-out";
type StaffFetch = (input: string, init?: RequestInit) => Promise<Response>;

type StaffSession = {
  status: StaffSessionStatus;
  email?: string;
  staffFetch: StaffFetch;
  signOut: () => Promise<void>;
};

const unconfiguredSession: StaffSession = {
  status: "unconfigured",
  async staffFetch() {
    throw new Error("Staff sign-in is not configured yet.");
  },
  async signOut() {}
};

const StaffSessionContext = createContext<StaffSession>(unconfiguredSession);

function ClerkStaffSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, sessionClaims } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const status: StaffSessionStatus = isSigningOut
    ? "signing-out"
    : !isLoaded
      ? "loading"
      : isSignedIn
        ? "signed-in"
        : "signed-out";
  const sessionKey = `${status}:${user?.id ?? "anonymous"}`;
  const activeSessionKeyRef = useRef(sessionKey);
  useLayoutEffect(() => {
    activeSessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const staffFetch = useCallback<StaffSession["staffFetch"]>(async (input, init) => {
    const requestSessionKey = sessionKey;
    if (activeSessionKeyRef.current !== requestSessionKey) throw new Error("Staff session changed. Try again.");
    if (!isLoaded) throw new Error("Staff session is still loading.");
    if (!isSignedIn) throw new Error("Sign in with an authorized staff account first.");
    const approvedUrl = approvedStaffApiUrl(input, window.location.origin);
    const token =
      sessionClaims?.aud === "convex"
        ? await getToken()
        : await getToken({ template: "convex" });
    if (!token) throw new Error("Could not create a staff session token.");
    if (activeSessionKeyRef.current !== requestSessionKey) throw new Error("Staff session changed. Try again.");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(approvedUrl, { ...init, headers });
  }, [getToken, isLoaded, isSignedIn, sessionClaims?.aud, sessionKey]);

  const endSession = useCallback(async () => {
    activeSessionKeyRef.current = `${sessionKey}:invalidated`;
    setIsSigningOut(true);
    try {
      await signOut({ redirectUrl: "/staff-sign-in" });
    } finally {
      setIsSigningOut(false);
    }
  }, [sessionKey, signOut]);

  const value = useMemo<StaffSession>(
    () => ({
      status,
      email: user?.primaryEmailAddress?.emailAddress,
      staffFetch,
      signOut: endSession
    }),
    [endSession, staffFetch, status, user?.primaryEmailAddress?.emailAddress]
  );

  return (
    <StaffSessionContext.Provider value={value}>
      <Fragment key={sessionKey}>{children}</Fragment>
    </StaffSessionContext.Provider>
  );
}

export function StaffAuthProvider({ children, enabled }: { children?: ReactNode; enabled: boolean }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!enabled || !publishableKey) {
    return <StaffSessionContext.Provider value={unconfiguredSession}>{children}</StaffSessionContext.Provider>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} signInUrl="/staff-sign-in">
      <ClerkStaffSession>{children}</ClerkStaffSession>
    </ClerkProvider>
  );
}

export function useStaffSession() {
  return useContext(StaffSessionContext);
}
