import { listTicketPackages } from "@skyla/payments";

export const siteConfig = {
  name: "Sky LA",
  domain: "skydeckla.com",
  email: "reservations@skydeckla.com",
  // Pre-launch gate. Widened to boolean because this flips at launch: false
  // keeps every purchase path disabled, true restores them site-wide.
  launched: false as boolean,
  launchStatus: {
    label: "Coming soon",
    message: "Sky LA is not open yet. Ticket sales are not live."
  },
  address: {
    short: "6100 Wilshire Blvd · Los Angeles",
    full: "6100 Wilshire Blvd, Top Floor, Los Angeles, CA 90048"
  }
} as const;

const ticketDescriptions: Record<string, string> = {
  general: "The full 360-degree view, indoor lounge, and timed entry. Ages 12 and under $10.",
  drink: "Observation deck access with one coffee or matcha voucher."
};

export const ticketPackages = listTicketPackages().map((ticketPackage) => ({
  key: ticketPackage.key,
  name: ticketPackage.name,
  price: ticketPackage.priceCents / 100,
  priceCents: ticketPackage.priceCents,
  description: ticketDescriptions[ticketPackage.key] ?? ticketPackage.name
}));
