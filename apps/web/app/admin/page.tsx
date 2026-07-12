import type { Metadata } from "next";
import Link from "next/link";
import { catalogProvenance, listCatalogItems } from "@skyla/payments";
import { ShieldCheck } from "@skyla/ui/icons";
import { AdminOpsClient } from "@/components/admin-ops-client";
import { StaffAuthProvider } from "@/components/staff-auth-provider";
import { isStaffAuthConfigured } from "@/lib/staff-auth-config";

export const metadata: Metadata = {
  title: "Admin Ops",
  description: "Staff-only Sky LA operations snapshot.",
  robots: {
    index: false,
    follow: false
  }
};

export default function AdminPage() {
  const catalog = listCatalogItems({ activeOnly: false }).map((item) => ({
    key: item.key,
    kind: item.kind,
    name: item.name,
    priceCents: item.priceCents,
    active: item.active
  }));

  return (
    <StaffAuthProvider enabled={isStaffAuthConfigured()}>
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
            <Link href="/pos" prefetch={false}>
              POS
            </Link>
          </nav>
        </header>

        <AdminOpsClient catalog={catalog} catalogState={catalogProvenance} />
      </main>
    </StaffAuthProvider>
  );
}
