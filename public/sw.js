// Service worker, aby šla hra nainstalovat jako aplikace.
// Vždy bere nejnovější verzi ze sítě (aktualizace a „Upravování“ fungují jako dřív);
// uloženou stránku použije jen bez internetu.
const CACHE = 'had-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put('/', copy));
        return response;
      })
      .catch(() => caches.match('/')),
  );
});
