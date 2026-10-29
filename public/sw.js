const CACHE = 'jardim-static-v3';
const STATIC = ['/app.css', '/app.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

// Apenas arquivos públicos são armazenados. Dados do usuário e API sempre vêm do servidor.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !STATIC.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
    return response;
  }).catch(() => caches.match(event.request)));
});
