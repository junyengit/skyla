import type { Metadata } from "next";
import Link from "next/link";
import { AdminCalendarClient } from "@/components/admin-calendar-client";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = {
  title: "Private-event calendar", description: "Staff-only recorded Sky LA private-event dates.",
  robots: { index: false, follow: false }
};
export default function CalendarPage() {
  return <StaffAuthProvider enabled={isStaffAuthConfigured()}>
    <main className="adminOpsPage calendarPage">
      <header className="adminOpsHeader"><Link className="brand" href="/">Sky LA</Link>
        <nav aria-label="Staff navigation"><Link href="/admin" prefetch={false}>Operations</Link><Link href="/admin/billing" prefetch={false}>Billing</Link><Link href="/admission" prefetch={false}>Admission</Link><Link href="/pos" prefetch={false}>POS</Link></nav>
      </header>
      <AdminCalendarClient />
    </main>
  </StaffAuthProvider>;
}
