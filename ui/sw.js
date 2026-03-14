self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('stowge-v1').then(c => c.addAll([
    '/', '/manifest.webmanifest'
  ])));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request)).catch(() => new Response('', { status: 404 }))
  );
});
