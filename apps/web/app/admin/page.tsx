import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "@skyla/ui/icons";
import { AdminOpsClient } from "@/components/admin-ops-client";

export const metadata: Metadata = {
  title: "Admin Ops",
  description: "Staff-only Sky LA operations snapshot.",
  robots: {
    index: false,
    follow: false
  }
};

export default function AdminPage() {
  return (
    <main className="adminOpsPage">
      <header className="adminOpsHeader">
        <Link className="brand" href="/">
          Sky LA
        </Link>
        <div className="adminOpsStatus">
          <ShieldCheck size={18} />
          <span>Staff ops</span>
        </div>
        <nav aria-label="Staff navigation">
          <Link href="/pos-next" prefetch={false}>
            POS Draft
          </Link>
          <Link href="/admin.html" prefetch={false}>
            Legacy Admin
          </Link>
        </nav>
      </header>

      <AdminOpsClient />
    </main>
  );
}
