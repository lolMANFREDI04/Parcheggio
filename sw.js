/**
 * Service Worker — Posizione Parcheggio v7
 * Stale-while-revalidate for app shell, network-only for APIs.
 * Navigation preload enabled for faster page loads.
 * Push notification support for parking reminders.
 */

var CACHE_NAME = 'parcheggio-v7';
var PRECACHE = [
    './',
    './index.html',
    './manifest.json',
    './logo.svg',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './og-image.png'
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

// ===== Reminder state via Cache API (SW can't access localStorage) =====
var NOTIF_CACHE = 'parking-notif-state';

function checkAndFireReminder() {
    return caches.open(NOTIF_CACHE).then(function(cache) {
        return cache.match('reminder-state');
    }).then(function(response) {
        if (!response) return;
        return response.json();
    }).then(function(state) {
        if (!state || state.dismissed) return;
        if (Date.now() >= state.scheduledAt) {
            var body = state.address
                ? 'La tua auto è parcheggiata in: ' + state.address
                : 'Non dimenticare dove hai parcheggiato!';
            state.dismissed = true;
            return caches.open(NOTIF_CACHE).then(function(cache) {
                return cache.put('reminder-state', new Response(JSON.stringify(state), {
                    headers: { 'Content-Type': 'application/json' }
                }));
            }).then(function() {
                return self.registration.showNotification('\ud83d\ude97 Ricordi dove hai parcheggiato?', {
                    body: body,
                    icon: 'logo.svg',
                    badge: 'logo.svg',
                    tag: 'parking-reminder',
                    requireInteraction: true,
                    vibrate: [100, 50, 100, 50, 100]
                });
            });
        }
    }).catch(function() {});
}

// ===== Periodic Background Sync — fires even when app is closed (Android/Chrome) =====
self.addEventListener('periodicsync', function(event) {
    if (event.tag === 'check-parking-reminder') {
        event.waitUntil(checkAndFireReminder());
    }
});

// ===== Background Sync fallback =====
self.addEventListener('sync', function(event) {
    if (event.tag === 'check-parking-reminder') {
        event.waitUntil(checkAndFireReminder());
    }
});

// ===== Message handler =====
self.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;

    // Show notification directly
    if (data.type === 'SHOW_NOTIFICATION') {
        event.waitUntil(
            self.registration.showNotification(data.title || 'Parcheggio', {
                body: data.body || '',
                icon: 'logo.svg',
                badge: 'logo.svg',
                tag: data.tag || 'parking-reminder',
                requireInteraction: true,
                vibrate: [100, 50, 100, 50, 100]
            })
        );
    }

    // Store reminder state in Cache API (so SW can read it independently)
    if (data.type === 'SET_REMINDER') {
        event.waitUntil(
            caches.open(NOTIF_CACHE).then(function(cache) {
                return cache.put('reminder-state', new Response(JSON.stringify(data.state), {
                    headers: { 'Content-Type': 'application/json' }
                }));
            })
        );
    }

    // Clear reminder (user passed nearby their car)
    if (data.type === 'CLEAR_REMINDER') {
        event.waitUntil(
            caches.open(NOTIF_CACHE).then(function(cache) {
                return cache.delete('reminder-state');
            })
        );
    }

    // Force check now (e.g. on visibilitychange)
    if (data.type === 'CHECK_REMINDER') {
        event.waitUntil(checkAndFireReminder());
    }
});

// ===== Notification click — open the app =====
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clients) {
                for (var i = 0; i < clients.length; i++) {
                    if (clients[i].url.indexOf(self.registration.scope) !== -1) {
                        return clients[i].focus();
                    }
                }
                return self.clients.openWindow('./');
            })
    );
});
