import { listTicketPackages } from "@skyla/payments";

export const siteConfig = {
  name: "Sky LA",
  domain: "skydeckla.com",
  email: "reservations@skydeckla.com",
  address: {
    short: "6100 Wilshire Blvd · Los Angeles",
    full: "6100 Wilshire Blvd, Top Floor, Los Angeles, CA 90048"
  }
} as const;

const ticketDescriptions: Record<string, string> = {
  general: "360-degree observation deck, indoor lounge, and timed entry.",
  drink: "Observation deck access with one coffee or matcha voucher."
};

export const ticketPackages = listTicketPackages().map((ticketPackage) => ({
  key: ticketPackage.key,
  name: ticketPackage.name,
  price: ticketPackage.priceCents / 100,
  priceCents: ticketPackage.priceCents,
  description: ticketDescriptions[ticketPackage.key] ?? ticketPackage.name
}));
