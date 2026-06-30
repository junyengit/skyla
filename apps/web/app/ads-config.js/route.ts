const conversionKeys = {
  purchase: "NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_CONVERSION",
  eventLead: "NEXT_PUBLIC_GOOGLE_ADS_EVENT_LEAD_CONVERSION",
  membershipLead: "NEXT_PUBLIC_GOOGLE_ADS_MEMBERSHIP_LEAD_CONVERSION",
  beginCheckout: "NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_CONVERSION"
} as const;

function publicValue(name: string) {
  return process.env[name]?.trim() || "";
}

export function GET() {
  const config = {
    googleTagId: publicValue("NEXT_PUBLIC_GOOGLE_ADS_TAG_ID"),
    conversions: Object.fromEntries(
      Object.entries(conversionKeys).map(([key, envName]) => [key, publicValue(envName)])
    )
  };

  return new Response(`window.SKYLA_ADS = ${JSON.stringify(config)};\n`, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "Content-Type": "application/javascript; charset=utf-8"
    }
  });
}
