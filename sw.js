/* Poker Trainer service worker — the casino in your pocket.
 * Strategy: precache every page and asset at install (all relative paths, so
 * the GitHub Pages mirror under /poker-trainer/ works identically);
 * navigations go NETWORK-FIRST (a deploy reaches you on the next load) with
 * the cache as the offline fallback; static assets go cache-first. The cache
 * name carries the app version, and activation deletes every older cache. */
const CACHE = "poker-trainer-0.20.0";
const PAGES = ["./", "./index.html", "./trainer.html", "./play.html", "./table.html",
  "./profile.html", "./roulette.html", "./craps.html", "./paigow.html", "./bj.html", "./bac.html", "./sp21.html", "./flush.html", "./sheep.html", "./moguls.html"];
const ASSETS = ["./favicon.svg", "./manifest.webmanifest",
  "./vendor/react.production.min.js", "./vendor/react-dom.production.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES.concat(ASSETS))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("poker-trainer-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;      // never touch cross-origin
  if (url.pathname.includes("/api/")) return;                                    // live data is live
  if (e.request.mode === "navigate" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
