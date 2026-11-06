"use client";

import Image from "next/image";
import { useState } from "react";

export function TicketQr({ ticketCode }: { ticketCode: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status">The QR could not load. Show your booking reference to staff, or reload this page.</p>;
  return <Image className="ticketQr" src={`/tickets/${encodeURIComponent(ticketCode)}/qr`} width={260} height={260}
    alt="QR code for this Sky LA ticket" unoptimized loading="eager" onError={() => setFailed(true)} />;
}
