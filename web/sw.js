// Service worker: lets the TV player start with no internet connection.
// App files are served network-first (so updates arrive) with a cache fallback.
const SHELL = 'signage-shell-v5';
const PRECACHE = ['player.html', 'config.js', 'css/stage.css', 'js/player.js', 'js/renderer.js', 'js/license.js', 'js/remote.js', 'js/sb.js', 'js/imgfit.js', 'js/widgets.js', 'logo.png', 'vendor/supabase.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/__media/')) return;              // handled by the player
  if (url.pathname.startsWith('/docs/')) return;                 // PDF guides: no need to keep copies
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !cdn) return;                               // never touch Supabase API calls
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(e.request, { ignoreSearch: sameOrigin });
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
