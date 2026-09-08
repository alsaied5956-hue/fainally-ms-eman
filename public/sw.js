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

// Push Notification Event Listener (Web Push API - triggers when app is completely closed)
self.addEventListener("push", (event) => {
  let data = {
    title: "منظومة الأستاذة إيمان الدمشيتي",
    body: "تنبيه جديد بخصوص الطالب في المنظومة",
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

  const notifTag = data.tag || data.eventId || `eman-push-${Date.now()}`;
  const isChat = data.type === "chat" || String(notifTag).includes("chat");

  const options = {
    body: data.body,
    icon: data.icon || "/icon.svg",
    badge: data.badge || "/icon.svg",
    vibrate: [500, 200, 500, 200, 800], // Strong high-priority vibration pattern
    silent: false, // Rings device's notification ringtone
    renotify: true, // Alerts phone sound even if prior notification is in tray
    requireInteraction: true,
    tag: notifTag,
    actions: isChat
      ? [
          { action: "open_chat", title: "💬 فتح المحادثة" },
          { action: "open_portal", title: "عرض المنظومة" }
        ]
      : [
          { action: "open_portal", title: "عرض المنظومة" },
          { action: "view_attendance", title: "سجل الحضور" }
        ],
    data: {
      url: isChat ? "/?tab=chat" : (data.url || "/"),
      eventId: data.eventId,
      timestamp: data.timestamp || Date.now()
    },
    dir: "rtl",
    lang: "ar"
  };

  // Broadcast to open clients so they can immediately mark event as processed
  const notifyClients = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    clientList.forEach((client) => {
      client.postMessage({
        type: "PUSH_RECEIVED",
        eventId: data.eventId,
      });
    });
  });

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      notifyClients
    ])
  );
});

// Periodic Background Sync Event Listener (triggers background checks even when app is closed)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "attendance-schedule-check") {
    event.waitUntil(
      Promise.resolve()
    );
  }
});

// Background Sync Event Listener (replays actions when network reconnects)
self.addEventListener("sync", (event) => {
  if (event.tag === "attendance-sync") {
    event.waitUntil(
      Promise.resolve()
    );
  }
});

// Client Message Listener: allows app tabs and background sync to trigger OS notifications with phone sound
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_PORTAL_NOTIFICATION") {
    const { title, body, icon, badge, url, vibrate, sound, tag, data } = event.data;
    const options = {
      body: body || "",
      icon: icon || "/icon.svg",
      badge: badge || "/icon.svg",
      vibrate: vibrate || [300, 100, 300, 100, 400],
      silent: false, // Ensures mobile sound rings
      renotify: true,
      requireInteraction: true,
      tag: tag || `eman-${Date.now()}`,
      data: {
        url: url || "/",
        ...(data || {})
      },
      dir: "rtl",
      lang: "ar"
    };

    event.waitUntil(
      self.registration.showNotification(title || "منظومة الأستاذة إيمان الدمشيتي", options)
    );
  }
});

// Notification Click Handler: focuses existing window or opens the portal
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let targetUrl = event.notification.data?.url || "/";

  if (event.action === "open_chat") {
    targetUrl = "/?tab=chat";
  } else if (event.action === "view_attendance") {
    targetUrl = "/?tab=attendance";
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (client.url && client.navigate) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
