export const siteConfig = {
  name: "Sky LA",
  domain: "skydeckla.com",
  email: "reservations@skydeckla.com",
  address: {
    short: "6100 Wilshire Blvd · Los Angeles",
    full: "6100 Wilshire Blvd, Top Floor, Los Angeles, CA 90048"
  }
} as const;

export const ticketPackages = [
  {
    key: "general",
    name: "General Admission",
    price: 19.99,
    description: "360-degree observation deck, indoor lounge, and timed entry."
  },
  {
    key: "drink",
    name: "Deck + Drink",
    price: 24,
    description: "Observation deck access with one coffee or matcha voucher."
  }
] as const;
