import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";

const serif = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif"
});

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

export const metadata: Metadata = {
  metadataBase: new URL("https://skydeckla.com"),
  title: {
    default: "Sky LA | Los Angeles Above It All",
    template: "%s | Sky LA"
  },
  description:
    "360-degree rooftop views, cafe, private experiences, and ticketed visits above 6100 Wilshire in Los Angeles.",
  openGraph: {
    type: "website",
    siteName: "Sky LA",
    title: "Sky LA | Los Angeles Above It All",
    description:
      "Rooftop observation deck, cafe, and lounge above Los Angeles.",
    images: ["/images/og-image.jpg"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090909"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
