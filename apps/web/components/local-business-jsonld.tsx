import { siteConfig, ticketPackages } from "@skyla/config";
import { operatingWeekdays, type PublicOperatingConfig } from "@/lib/operating-hours";

export function LocalBusinessJsonLd({ config }: { config: PublicOperatingConfig | null }) {
  const prices = ticketPackages.map((ticket) => ticket.price);
  const openDays = config
    ? operatingWeekdays.filter((day) => !config.operatingHours[day].closed)
    : [];

  const data = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "TouristAttraction"],
    name: siteConfig.name,
    url: `https://${siteConfig.domain}`,
    email: siteConfig.email,
    image: `https://${siteConfig.domain}/images/og-image.jpg`,
    priceRange: `$${Math.min(...prices)} - $${Math.max(...prices)}`,
    isAccessibleForFree: false,
    address: {
      "@type": "PostalAddress",
      streetAddress: "6100 Wilshire Blvd, Top Floor",
      addressLocality: "Los Angeles",
      addressRegion: "CA",
      postalCode: "90048",
      addressCountry: "US"
    },
    ...(openDays.length > 0 && config
      ? {
          openingHoursSpecification: openDays.map((day) => ({
            "@type": "OpeningHoursSpecification",
            dayOfWeek: day,
            opens: config.operatingHours[day].open,
            closes: config.operatingHours[day].close
          }))
        }
      : {})
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
