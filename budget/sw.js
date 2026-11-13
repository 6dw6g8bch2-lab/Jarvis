// Offline-Cache: App-Dateien zuerst aus dem Cache, im Hintergrund aktualisieren.
const CACHE = "lionels-budget-v3.0.0";
const FILES = ["./", "index.html", "styles.css", "app.js", "sync.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, {ignoreSearch: true});
    const net = fetch(req, {cache: "no-cache"}).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    e.waitUntil(net.then(() => {}, () => {}));
    return hit || net;
  }));
});
