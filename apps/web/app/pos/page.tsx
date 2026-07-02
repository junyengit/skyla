import type { Metadata } from "next";
import { PosRegisterPage } from "@/components/pos-register-page";

export const metadata: Metadata = {
  title: "POS",
  description: "Server-reviewed Sky LA POS sale drafts.",
  robots: {
    index: false,
    follow: false
  }
};

export default function PosPage() {
  return <PosRegisterPage variant="primary" />;
}
