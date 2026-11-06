const VER = "rk-v7";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VER)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  if (new URL(r.url).origin !== location.origin) return;
  if (r.mode === "navigate"){
    e.respondWith(fetch(r).then(a => {
      const b = a.clone(); caches.open(VER).then(c => c.put("./index.html", b)); return a;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(r).then(t => t || fetch(r).then(a => {
    const b = a.clone(); caches.open(VER).then(c => c.put(r, b)); return a;
  })));
});