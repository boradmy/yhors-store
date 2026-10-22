// YHORS PANEL: service worker mínimo para instalación.
// Sin almacenamiento offline de pedidos, datos personales, credenciales ni API.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate' && new URL(event.request.url).pathname.startsWith('/panelyhorstore')) {
    event.respondWith(fetch(event.request));
  }
});
