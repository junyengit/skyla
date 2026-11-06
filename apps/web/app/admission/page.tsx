import type { Metadata } from "next";
import Link from "next/link";
import { AdmissionClient } from "@/components/admission-client";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = { title: "Admission", robots: { index: false, follow: false } };
export default function AdmissionPage() {
  return <StaffAuthProvider enabled={isStaffAuthConfigured()}><main className="adminOpsPage">
    <header className="adminOpsHeader"><Link className="brand" href="/">Sky LA</Link><nav aria-label="Staff navigation"><Link href="/admin" prefetch={false}>Operations</Link><Link href="/pos" prefetch={false}>POS</Link></nav></header>
    <AdmissionClient />
  </main></StaffAuthProvider>;
}
