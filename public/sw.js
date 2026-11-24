// Service worker, aby šla hra nainstalovat jako aplikace.
// Aplikace má mít vždy stejnou (nejnovější) verzi jako prohlížeč: stránka se pokaždé stáhne
// ze sítě bez jakékoliv mezipaměti (no-store); uloženou kopii použije jen bez internetu.
const CACHE = 'had-app-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  // hra je '/', telefon na výšku má otočenou stránku '/otoceny' – každá se uloží zvlášť
  const key = new URL(request.url).pathname === '/otoceny' ? '/otoceny' : '/';
  event.respondWith(
    fetch(request.url, { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => {
        if (response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(() => caches.match(key).then((r) => r || caches.match('/'))),
  );
});
