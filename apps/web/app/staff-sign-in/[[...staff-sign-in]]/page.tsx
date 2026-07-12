import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "@skyla/ui/icons";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { StaffSignIn } from "@/components/staff-sign-in";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = {
  title: "Staff Sign In",
  description: "Authorized Sky LA staff sign-in.",
  robots: { index: false, follow: false }
};

const allowedReturnRoutes = new Set(["/admin", "/pos", "/pos-next"] as const);

export default async function StaffSignInPage({
  searchParams
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const configured = isStaffAuthConfigured();
  const requestedReturn = (await searchParams).returnTo;
  const returnTo = allowedReturnRoutes.has(requestedReturn as "/admin" | "/pos" | "/pos-next")
    ? (requestedReturn as "/admin" | "/pos" | "/pos-next")
    : "/admin";

  return (
    <StaffAuthProvider enabled={configured}>
      <main className="adminOpsPage">
        <header className="adminOpsHeader">
          <Link className="brand" href="/">
            Sky LA
          </Link>
          <div className="adminOpsStatus">
            <ShieldCheck size={18} />
            <span>Staff access</span>
          </div>
        </header>
        <section className="staffSignInShell" aria-label="Staff sign in">
          {configured ? (
            <StaffSignIn returnTo={returnTo} />
          ) : (
            <div className="adminOpsPanel">
              <h1>Staff sign-in is not configured</h1>
              <p>Clerk and Convex dashboard setup must be completed before staff access is enabled.</p>
            </div>
          )}
        </section>
      </main>
    </StaffAuthProvider>
  );
}
