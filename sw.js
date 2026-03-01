const CACHE_NAME = 'parcheggio-v1';
const ASSETS = [
    './index.html',
    './manifest.json'
];

// Install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET and external API requests
    if (event.request.method !== 'GET') return;
    
    // For API calls (geocoding), always try network
    if (event.request.url.includes('nominatim')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
        );
        return;
    }

    // For app assets, try cache first then network
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                const fetchPromise = fetch(event.request)
                    .then(response => {
                        // Update cache
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                        return response;
                    })
                    .catch(() => cached);
                
                return cached || fetchPromise;
            })
    );
});
