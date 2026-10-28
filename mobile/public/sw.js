/* Service worker for the web build on GitHub Pages.
 * 1. Adds the COOP/COEP headers GitHub Pages can't send, so the page is cross-origin isolated and
 *    expo-sqlite's WebAssembly worker gets SharedArrayBuffer (same idea as gzuidhof/coi-serviceworker).
 * 2. Network first, cache as fallback: always the latest version online, still opens offline. */
const CACHE = 'jump-attack-v1';

function isolate(response) {
  if (response.status === 0) return response; // opaque responses can't be rewrapped
  const headers = new Headers(response.headers);
  // require-corp, not credentialless: Safari doesn't support credentialless, and every file is same-origin anyway.
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function shouldHandle(request, origin) {
  return request.method === 'GET' && new URL(request.url).origin === origin;
}

async function respond(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return isolate(response);
  } catch (error) {
    // Offline: the cached file, or the app shell for a page that was never opened (routing happens in the app).
    const cached = (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match(self.registration.scope) : undefined);
    if (cached) return isolate(cached);
    throw error;
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof module === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    if (shouldHandle(event.request, self.location.origin)) event.respondWith(respond(event.request));
  });
}

if (typeof module !== 'undefined') module.exports = { isolate, shouldHandle };
