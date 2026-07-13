export function normalizeWebTicketCode(value: string) {
  const ticketCode = value.trim().toLowerCase();
  if (!/^tkt_[a-f0-9]{32}$/.test(ticketCode)) throw new Error("Ticket was not found");
  return ticketCode;
}

export function normalizeTicketOrigin(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) throw new Error("SKYLA_PUBLIC_ORIGIN must be configured");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("SKYLA_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SKYLA_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  return url.origin;
}
