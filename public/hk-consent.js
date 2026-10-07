/* HK Growth: Einwilligung und Tracking. Lädt Meta-Pixel und Google-Tag erst nach Einwilligung.
   Konfiguration über window.HK_TRACKING (aus /assets/tracking-config.js):
   { metaPixelId, googleAdsId, googleConversions: { Lead: "AW-123/abc" }, leadPaths: ["/danke"], pathEvents: { "/bestellt": "Purchase" }, privacyPath: "/datenschutz", tone: "sie"|"du" } */
(function () {
  "use strict";
  var cfg = window.HK_TRACKING || {};
  var hasMeta = !!cfg.metaPixelId, hasGoogle = !!cfg.googleAdsId;
  if (!hasMeta && !hasGoogle) return;
  var KEY = "hk_consent", VERSION = 1, MAX_AGE = 180 * 24 * 3600, du = cfg.tone === "du";

  function cookieGet(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (!raw) raw = cookieGet(KEY);
    if (!raw) return null;
    try { var v = JSON.parse(raw); if (v.v !== VERSION || Date.now() - v.ts > MAX_AGE * 1000) return null; return v; } catch (e) { return null; }
  }
  function write(v) {
    v.v = VERSION; v.ts = Date.now();
    var s = JSON.stringify(v);
    try { localStorage.setItem(KEY, s); } catch (e) {}
    try { document.cookie = KEY + "=" + encodeURIComponent(s) + "; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : ""); } catch (e) {}
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  function eventIdFromUrl() { var m = location.search.match(/[?&]eid=([\w-]{8,64})/); return m ? m[1] : null; }

  /* Google Consent Mode v2: alles verweigert, bis die Einwilligung vorliegt. */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (!window.gtag) window.gtag = gtag;
  if (hasGoogle) window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", wait_for_update: 500 });

  var loaded = false;
  function loadMeta() {
    if (window.fbq) return;
    var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    var t = document.createElement("script"); t.async = true; t.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(t);
    window.fbq("init", cfg.metaPixelId);
    window.fbq("track", "PageView");
  }
  function loadGoogle() {
    var s = document.createElement("script"); s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(cfg.googleAdsId);
    document.head.appendChild(s);
    window.gtag("js", new Date());
    window.gtag("config", cfg.googleAdsId, { allow_enhanced_conversions: true });
  }
  function track(name, params, id) {
    params = params || {};
    if (window.fbq) window.fbq("track", name, params, id ? { eventID: id } : undefined);
    if (hasGoogle && window.gtag) {
      var conv = (cfg.googleConversions || {})[name];
      if (conv) window.gtag("event", "conversion", { send_to: conv, transaction_id: id || undefined });
      window.gtag("event", name.toLowerCase(), params);
    }
  }
  var bound = false;
  function bind() {
    if (bound) return; bound = true;
    var path = location.pathname.replace(/\/$/, "") || "/";
    if ((cfg.leadPaths || []).some(function (p) { return (p.replace(/\/$/, "") || "/") === path; })) track("Lead", { content_name: path }, eventIdFromUrl() || uuid());
    var pe = cfg.pathEvents || {};
    Object.keys(pe).forEach(function (p) { if ((p.replace(/\/$/, "") || "/") === path) track(pe[p], { content_name: path }, eventIdFromUrl() || uuid()); });
    document.addEventListener("hk:lead", function (ev) { var d = ev.detail || {}; track("Lead", { content_name: d.name || path }, d.eventId || uuid()); });
    document.addEventListener("hk:track", function (ev) { var d = ev.detail || {}; if (d.name) track(d.name, d.params, d.eventId); });
    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("a,button") : null;
      if (!el) return;
      var custom = el.getAttribute("data-track");
      if (custom && custom !== "none") { track(custom, { content_name: el.getAttribute("data-track-name") || el.textContent.trim().slice(0, 80) }); return; }
      var h = el.getAttribute("href") || "";
      if (h.indexOf("tel:") === 0) track("Contact", { content_name: "Telefon" });
      else if (h.indexOf("mailto:") === 0) track("Contact", { content_name: "E-Mail" });
    }, true);
  }
  function grant() {
    if (loaded) return; loaded = true;
    if (hasGoogle) window.gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" });
    if (hasMeta) loadMeta();
    if (hasGoogle) loadGoogle();
    bind();
  }

  /* Banner */
  var box = null;
  function close() { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }
  function banner() {
    if (box) return;
    var privacy = cfg.privacyPath || "/datenschutz";
    var text = du
      ? "Wir nutzen das Meta-Pixel und den Google-Tag, um unsere Anzeigen zu messen und zu verbessern. Das passiert nur, wenn du zustimmst. Deine Wahl kannst du jederzeit über „Cookie-Einstellungen“ im Fußbereich ändern."
      : "Wir nutzen das Meta-Pixel und den Google-Tag, um unsere Anzeigen zu messen und zu verbessern. Das passiert nur mit Ihrer Einwilligung. Sie können Ihre Wahl jederzeit über „Cookie-Einstellungen“ im Fußbereich ändern.";
    box = document.createElement("div");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Cookie-Einstellungen"); box.id = "hk-consent";
    box.innerHTML =
      '<style>#hk-consent{position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:440px;margin-left:auto;background:#15171a;color:#f2f3f5;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px 18px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
      '#hk-consent h2{margin:0 0 6px;font-size:15px;font-weight:600}#hk-consent p{margin:0 0 12px;color:#c9ccd1}#hk-consent a{color:#fff;text-decoration:underline}' +
      '#hk-consent .b{display:flex;flex-wrap:wrap;gap:8px}#hk-consent button{cursor:pointer;border-radius:999px;padding:9px 16px;font:inherit;font-weight:600;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff}' +
      '#hk-consent button.p{background:#fff;color:#15171a;border-color:#fff}#hk-consent button:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}</style>' +
      "<h2>Cookies und Anzeigenmessung</h2><p>" + text + ' <a href="' + privacy + '">Datenschutzerklärung</a></p>' +
      '<div class="b"><button type="button" class="p" data-c="all">Alle akzeptieren</button><button type="button" data-c="none">Nur notwendige</button></div>';
    box.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("button[data-c]") : null;
      if (!b) return;
      if (b.getAttribute("data-c") === "all") { write({ marketing: true }); close(); grant(); }
      else { write({ marketing: false }); close(); }
    });
    document.body.appendChild(box);
    var first = box.querySelector("button.p"); if (first) first.focus({ preventScroll: true });
  }
  window.hkConsent = { open: banner, accept: function () { write({ marketing: true }); close(); grant(); }, decline: function () { write({ marketing: false }); close(); }, track: track, state: read };
  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-consent-open]") : null;
    if (el) { ev.preventDefault(); banner(); }
  });

  var state = read();
  function start() { if (state && state.marketing) grant(); else if (!state) banner(); }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
