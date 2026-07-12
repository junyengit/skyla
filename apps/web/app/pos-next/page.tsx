import type { Metadata } from "next";
import { PosRegisterPage } from "@/components/pos-register-page";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = {
  title: "POS Draft",
  description: "Server-reviewed Sky LA POS sale drafts.",
  robots: {
    index: false,
    follow: false
  }
};

export default function PosNextPage() {
  return (
    <StaffAuthProvider enabled={isStaffAuthConfigured()}>
      <PosRegisterPage variant="draft" />
    </StaffAuthProvider>
  );
}
