// Pleaseme — service worker del catálogo (tienda.html).
// Hace que el catálogo se pueda instalar como aplicación y que abra aunque no haya internet.
// Solo toca la página del catálogo (red primero, copia guardada si no hay internet):
// todo lo demás (Facturación, Admin, Supabase, imágenes…) pasa directo, sin cache.
const CACHE = 'pleaseme-catalogo-v2';
const PRECACHE = ['./tienda.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== location.origin) return;
  if(!(req.mode === 'navigate' && /\/tienda\.html$/.test(url.pathname))) return;
  e.respondWith(
    fetch(req).then(res => {
      if(res && res.ok){ const copia = res.clone(); caches.open(CACHE).then(c => c.put('./tienda.html', copia)).catch(() => {}); }
      return res;
    }).catch(() => caches.match('./tienda.html', { ignoreSearch: true }).then(r => r || Response.error()))
  );
});
