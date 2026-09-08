// Service Worker for Offline & Online PWA Caching
const CACHE_NAME = "math-center-v4.0";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg"
];

// Install Event: Cache critical app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("Service Worker pre-cache partial warning:", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Cleanup older caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-First with Cache Fallback for dynamic, Stale-While-Revalidate for assets
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Don't intercept non-GET requests or Firebase/Google API cloud calls
  if (
    request.method !== "GET" ||
    request.url.includes("firestore.googleapis.com") ||
    request.url.includes("firebaseapp.com") ||
    request.url.includes("identitytoolkit.googleapis.com") ||
    request.url.includes("chrome-extension")
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // If response is valid, update cache in background
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed (Offline) -> Return cached response
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If navigation request (HTML), fallback to root index.html
          if (request.mode === "navigate") {
            return caches.match("/index.html") || caches.match("/");
          }
          return new Response("Offline resource unavailable", {
            status: 503,
            statusText: "Offline",
          });
        });
      })
  );
});

// Push Notification Event Listener (Web Push API)
self.addEventListener("push", (event) => {
  let data = {
    title: "منظومة الأستاذة إيمان الدمشيتي",
    body: "تحديث جديد بخصوص الطالب",
    icon: "/icon.svg",
    badge: "/icon.svg",
    url: "/"
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icon.svg",
    badge: data.badge || "/icon.svg",
    vibrate: [150, 80, 150],
    data: {
      url: data.url || "/",
      timestamp: Date.now()
    },
    dir: "rtl",
    lang: "ar"
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
