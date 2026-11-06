/* Build replaces these with this release's exact app-shell files and content hash. */
const ASSETS = __PRECACHE__
const CACHE = 'paykit-shell-' + __VERSION__
const BASE = __BASE__
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('paykit-shell-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  // Never cache API data, wallet requests, merchant credentials, or payment writes.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(BASE + 'index.html')))
    return
  }
  if (!ASSETS.includes(url.pathname)) return
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(url.pathname)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) await cache.put(url.pathname, response.clone())
    return response
  }))
})
