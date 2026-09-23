import type { MetadataRoute } from "next";

// Für „Zum Home-Bildschirm": erst als installierte Web-App erlaubt iOS
// (ab 16.4) Push-Benachrichtigungen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deal Operator",
    short_name: "Deal Operator",
    description:
      "Werkzeug fürs gemeinsame Callen: Tagesabschluss, Fortschritt und Erinnerungen.",
    start_url: "/tagesabschluss",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#0b2245",
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
