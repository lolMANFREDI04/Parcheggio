/**
 * Service Worker — Posizione Parcheggio v4
 * Stale-while-revalidate for app shell, network-only for APIs.
 * Navigation preload enabled for faster page loads.
 */

var CACHE_NAME = 'parcheggio-v4';
var PRECACHE = [
    './',
    './index.html',
    './manifest.json',
    './logo.svg',
    './og-image.svg'
];

// Install — precache app shell
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) { return cache.addAll(PRECACHE); })
            .then(function() { return self.skipWaiting(); })
    );
});

// Activate — purge old caches + enable navigation preload
self.addEventListener('activate', function(event) {
    event.waitUntil(
        Promise.all([
            caches.keys().then(function(keys) {
                return Promise.all(
                    keys.filter(function(k) { return k !== CACHE_NAME; })
                        .map(function(k) { return caches.delete(k); })
                );
            }),
            // Enable navigation preload if supported
            self.registration.navigationPreload
                ? self.registration.navigationPreload.enable()
                : Promise.resolve()
        ]).then(function() { return self.clients.claim(); })
    );
});

// Fetch handler
self.addEventListener('fetch', function(event) {
    var request = event.request;

    // Only intercept GET requests
    if (request.method !== 'GET') return;

    // Network-only for geocoding API (don't cache external data)
    if (request.url.indexOf('nominatim') !== -1) {
        event.respondWith(
            fetch(request).catch(function() {
                return new Response('{}', {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Navigation requests: use preload response or cache
    if (request.mode === 'navigate') {
        event.respondWith(
            (event.preloadResponse || Promise.resolve())
                .then(function(preload) {
                    if (preload) return preload;
                    return fetch(request).catch(function() {
                        return caches.match('./index.html');
                    });
                })
                .catch(function() {
                    return caches.match('./index.html');
                })
        );
        return;
    }

    // App assets: stale-while-revalidate
    event.respondWith(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.match(request).then(function(cached) {
                // Fire off network request in background
                var networkFetch = fetch(request).then(function(response) {
                    if (response && response.status === 200 && response.type === 'basic') {
                        cache.put(request, response.clone());
                    }
                    return response;
                }).catch(function() {
                    return cached;
                });

                // Serve cached immediately, update in background
                return cached || networkFetch;
            });
        })
    );
});
