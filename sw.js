// Offline support: cache the app shell, and keep card pictures on the phone so they
// show up instantly next time (card images never change, so they're cached for good).
const CACHE = 'packripped-v33';
const IMG_CACHE = 'packripped-images-v1';
const IMG_HOSTS = ['cards.scryfall.io', 'svgs.scryfall.io', 'assets.tcgdex.net', 'cdn.shopify.com', 'cdn11.bigcommerce.com'];
const IMG_MAX = 2500; // about 40 MB of pictures at most; oldest are dropped first
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'sounds.js', 'fx.js', 'odds.js', 'pokemon.js', 'commander.js', 'decks.js', 'config.js', 'social.js', 'trades.js', 'squishies.js', 'packwars-engine.js', 'packwars.js', 'vendor/supabase-2.119.0.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first for our own files (so updates show up), falling back to cache when offline.
let puts = 0;
async function cachedImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // Both image hosts allow CORS, so the saved copy is a normal (not opaque) response.
  const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
  if (res.ok) {
    cache.put(req.url, res.clone());
    if (++puts % 50 === 0) {
      const keys = await cache.keys();
      if (keys.length > IMG_MAX) await Promise.all(keys.slice(0, keys.length - IMG_MAX).map((k) => cache.delete(k)));
    }
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && IMG_HOSTS.includes(url.hostname)) {
    e.respondWith(cachedImage(e.request).catch(() => fetch(e.request)));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: always ask the server for the newest file (cheap when nothing changed)
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
