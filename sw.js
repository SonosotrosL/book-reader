const CACHE_VERSION = 'leitor-portatil-v4';
const APP_SHELL = [
  './',
  './portable_book_reader.html',
  './index.html',
  './manifest.webmanifest',
  './icon.svg'
];
const CDN_SHELL = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.allSettled(APP_SHELL.map((u) => cache.add(u)));
      await Promise.allSettled(CDN_SHELL.map((u) => cache.add(new Request(u, { mode: 'cors' }))));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  const url = new URL(req.url);
  // Nunca cachear rotas /api/* nem chamadas de API/Auth/Storage de nuvem
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) return;
  if (url.hostname.includes('supabase.co') || url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com') || url.hostname.includes('graph.microsoft.com') || url.hostname.includes('login.microsoftonline.com')) return;

  // Bibliotecas CDN (PDF.js): Cache-First
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // App Shell (mesma origem): Network-First sem cache HTTP obsoleto com fallback instantâneo para offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(req, { cache: 'no-store' })).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./portable_book_reader.html') || caches.match('./'))
      )
    );
  }
});
