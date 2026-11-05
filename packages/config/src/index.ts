import { listTicketPackages } from "@skyla/payments";

export * from "./sandbox-admission";

export const siteConfig = {
  name: "Sky LA",
  domain: "skydeckla.com",
  email: "reservations@skydeckla.com",
  // Individual-ticket transaction gate. False keeps checkout and purchase APIs
  // disabled. This gate describes online purchasing, not venue operations.
  launched: false as boolean,
  launchStatus: {
    label: "Online tickets pending",
    message:
      "Online ticket purchasing is not enabled here yet. Contact us about normal visits or full-venue bookings."
  },
  address: {
    short: "6100 Wilshire Blvd · Los Angeles",
    full: "6100 Wilshire Blvd, Top Floor, Los Angeles, CA 90048"
  }
} as const;

const ticketDescriptions: Record<string, string> = {
  general:
    "The full 360-degree view, indoor lounge, and timed entry. Adults 18+ $20, ages 8–17 $10, ages 0–7 free.",
  drink: "Observation deck access with one coffee or matcha voucher."
};

export const ticketPackages = listTicketPackages().map((ticketPackage) => ({
  key: ticketPackage.key,
  name: ticketPackage.name,
  price: ticketPackage.priceCents / 100,
  priceCents: ticketPackage.priceCents,
  description: ticketDescriptions[ticketPackage.key] ?? ticketPackage.name
}));
