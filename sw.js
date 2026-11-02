/* Service worker : permet à l'app de fonctionner sans connexion.
   Après chaque modification des fichiers, augmente le numéro de VERSION
   pour que l'iPhone télécharge la nouvelle version. */
const VERSION = 'revisions-v3';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Réseau d'abord (pour avoir les mises à jour), cache si hors ligne */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Seulement les fichiers de l'app : jamais les échanges avec GitHub (synchro)
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
