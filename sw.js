const CACHE_NAME = "flex-work-app-v1";
const URLS_TO_CACHE = [
    "/flex-work-app/",
    "/flex-work-app/index.html",
    "/flex-work-app/style.css",
    "/flex-work-app/script.js",
    "/flex-work-app/manifest.json"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            )
        )
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});