import type { Metadata, Viewport } from "next";
import { Archivo, Inter, Italiana, Manrope } from "next/font/google";
// Import order defines the cascade: tokens/base first, per-surface sheets in
// the original monolith order, and the shell tail last so its mobile-nav rules
// keep out-specifying the public-nav defaults.
import "./styles/base.css";
import "./styles/home.css";
import "./styles/showcase-home.css";
import "./styles/public.css";
import "./styles/legal.css";
import "./styles/tickets.css";
import "./styles/public-responsive.css";
import "./styles/checkout.css";
import "./styles/pos.css";
import "./styles/admin.css";
import "./styles/shell.css";

const display = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const showcaseDisplay = Italiana({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-showcase-display"
});

const showcaseBody = Manrope({
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-showcase-body"
});

export const metadata: Metadata = {
  metadataBase: new URL("https://skydeckla.com"),
  title: {
    default: "Sky LA | Los Angeles Above It All",
    template: "%s | Sky LA"
  },
  description:
    "Sky LA is currently available exclusively for full-venue bookings at 6100 Wilshire in Los Angeles.",
  alternates: {
    canonical: "./"
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/images/favicon-32.png", sizes: "32x32", type: "image/png" }
    ],
    apple: "/images/apple-touch-icon.png"
  },
  openGraph: {
    type: "website",
    siteName: "Sky LA",
    title: "Sky LA | Los Angeles Above It All",
    description:
      "Exclusive full-venue bookings above Wilshire, with 360-degree views of Los Angeles.",
    images: ["/images/og-image.jpg"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0c"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${showcaseDisplay.variable} ${showcaseBody.variable}`}
      data-scroll-behavior="smooth"
    >
      <body>{children}</body>
    </html>
  );
}
