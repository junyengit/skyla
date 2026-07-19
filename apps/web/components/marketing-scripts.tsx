import Script from "next/script";

// The committed ID keeps existing ad tracking working until the Vercel env var
// is set; setting NEXT_PUBLIC_META_PIXEL_ID to whitespace disables the pixel.
const META_PIXEL_ID = (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "27223205867364422").trim();

export function MarketingScripts() {
  return (
    <>
      {META_PIXEL_ID ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      ) : null}
      <Script src="/ads-config.js" strategy="afterInteractive" />
      <Script src="/ads-tracking.js?v=1" strategy="afterInteractive" />
    </>
  );
}
