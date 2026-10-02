import type { Metadata } from "next";
import Link from "next/link";
import { AdminBillingClient } from "@/components/admin-billing-client";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = {
  title: "Billing exceptions", description: "Staff-only recorded Sky LA billing evidence.", robots: { index: false, follow: false }
};
export default function BillingPage() {
  return <StaffAuthProvider enabled={isStaffAuthConfigured()}>
    <main className="adminOpsPage billingPage">
      <header className="adminOpsHeader"><Link className="brand" href="/">Sky LA</Link>
        <nav aria-label="Staff navigation"><Link href="/admin" prefetch={false}>Operations</Link><Link href="/admin/calendar" prefetch={false}>Calendar</Link><Link href="/admission" prefetch={false}>Admission</Link><Link href="/pos" prefetch={false}>POS</Link></nav>
      </header><AdminBillingClient />
    </main>
  </StaffAuthProvider>;
}
