/* Deal Operator Service Worker.
 *
 * Er tut genau zwei Dinge: eingehende Push-Nachrichten als Geräte-
 * Benachrichtigung anzeigen und beim Antippen die passende Seite öffnen.
 * Kein Offline-Cache, keine Hintergrund-Synchronisierung — dadurch kann er
 * keine veralteten Seiten ausliefern.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Deal Operator";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Gleicher tag ersetzt eine ältere Meldung derselben Art, statt eine
    // zweite danebenzulegen.
    tag: data.tag || undefined,
    renotify: false,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );
  // Nur eigene Seiten öffnen.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows)
          if (new URL(client.url).origin === target.origin && "focus" in client)
            return client.navigate(target.href).then((c) => (c || client).focus());
        return self.clients.openWindow(target.href);
      }),
  );
});
