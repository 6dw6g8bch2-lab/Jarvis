// Offline-Cache für WKS Wissen: App-Dateien aus dem Cache, im Hintergrund aktualisieren. GitHub-Anfragen gehen nie über den Cache.
const CACHE = "wks-wissen-v2.0.0";
const FILES = ["./", "index.html", "app.css", "app.js", "crypto.js", "demo.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("wks-wissen-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.includes("/wks/")) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, {ignoreSearch: true});
    const net = fetch(req, {cache: "no-cache"}).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    e.waitUntil(net.then(() => {}, () => {}));
    return hit || net;
  }));
});
