import Script from "next/script";

/**
 * Meta-Pixel und Google-Tag, nur nach Einwilligung (Banner aus /hk-consent.js).
 * Ohne NEXT_PUBLIC_META_PIXEL_ID und NEXT_PUBLIC_GOOGLE_ADS_ID wird nichts geladen.
 */
export function TrackingConsent() {
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  const googleAdsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? "";
  if (!metaPixelId && !googleAdsId) return null;
  const config = {
    metaPixelId,
    googleAdsId,
    googleConversions: {},
    leadPaths: [],
    pathEvents: { "/bestaetigen": "CompleteRegistration" },
    privacyPath: "/datenschutz",
    tone: "du",
  };
  return (
    <>
      <Script id="hk-tracking-config" strategy="beforeInteractive">
        {`window.HK_TRACKING=${JSON.stringify(config).replace(/</g, "\\u003c")};`}
      </Script>
      <Script src="/hk-consent.js" strategy="afterInteractive" />
    </>
  );
}
