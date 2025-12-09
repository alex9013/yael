const CACHE_NAME = 'todo-cache-v1';
const urlsToCache = [
    "/",
    "/index.html",
    "/styles.css",
    "/main-js",
    "/icons/icon192x192.png",
    "/icons/icon512x512.png"
];

self.addEventListener('install', (event) =>{
event.waitUntill(
    caches.open(CACHE_NAME).then((cache) =>{
        return cache.addAll(urlsToCache);
        })
    );
});
self.addEventListener("activate", (event) =>{
    event.waitUntill(
        caches.keys().then ((cachename) => {
            return Promise.all(
                cacheNames.map((cachename) => {
            if (cachename !== CACHE_NAME) {
                return caches.delete(cachename);
                }
             })
           );
        })
    );
});
