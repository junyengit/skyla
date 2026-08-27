import { listTicketPackages } from "@skyla/payments";

export const siteConfig = {
  name: "Sky LA",
  domain: "skydeckla.com",
  email: "reservations@skydeckla.com",
  // Individual-ticket transaction gate. False keeps checkout and purchase APIs
  // disabled. The public homepage offer changes only through an explicit
  // product decision; it is currently full-venue bookings only.
  launched: false as boolean,
  launchStatus: {
    label: "Full venue bookings only",
    message:
      "Individual tickets are not available. Sky LA is currently accepting full-venue booking inquiries only."
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
