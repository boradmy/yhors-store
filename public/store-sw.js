// Instalación de YHORS STORE: no cachear datos privados ni respuestas API.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
