// Service worker minimal : réseau d'abord pour l'app (toujours à jour),
// cache d'abord pour les icônes Community Dragon (immuables par patch).
const CACHE = 'coop-tft-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isIcon = url.hostname === 'raw.communitydragon.org' && url.pathname.endsWith('.png');
  if (!isIcon && url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (isIcon) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw err;
      }
    }),
  );
});
