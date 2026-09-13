/**
 * Firebase Cloud Messaging Service Worker (FCM PWA Background Handler)
 * Dispatches high-priority background audio alerts, vibrations, and notifications
 * even when the PWA / browser is completely closed.
 */

// Give the service worker access to Firebase Messaging.
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

// Initialize the Firebase app in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyA8SdOtbVmBF7tsfIC_WsAgOFQj6tkyjaw",
  authDomain: "ai-studio-applet-webapp-dffd3.firebaseapp.com",
  projectId: "ai-studio-applet-webapp-dffd3",
  storageBucket: "ai-studio-applet-webapp-dffd3.firebasestorage.app",
  messagingSenderId: "319901039747",
  appId: "1:319901039747:web:fcd7b7a92b3923b44fefb6",
});

const messaging = firebase.messaging();

// Handle FCM Background Messages
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Received FCM background message:", payload);

  const title =
    payload.notification?.title ||
    payload.data?.title ||
    "منظومة الأستاذة إيمان الدمشيتي";

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    "تنبيه جديد بخصوص الطالب في المنظومة";

  const notifType = payload.data?.type || "alert";
  const eventId = payload.data?.eventId || `fcm-${Date.now()}`;
  const targetUrl = payload.data?.url || (notifType === "chat" ? "/?tab=chat" : "/");

  const notificationOptions = {
    body,
    icon: payload.notification?.icon || payload.data?.icon || "/icon.svg",
    badge: "/icon.svg",
    vibrate: [500, 100, 500, 100, 500], // High-priority aggressive vibration pattern
    sound: "/notification.wav", // High-priority acoustic chime
    silent: false, // Rings mobile device chime
    renotify: true,
    requireInteraction: true,
    tag: payload.data?.tag || eventId,
    data: {
      url: targetUrl,
      eventId,
      type: notifType,
      sound: "/notification.wav",
      timestamp: Date.now(),
    },
    dir: "rtl",
    lang: "ar",
    actions:
      notifType === "chat"
        ? [
            { action: "open_chat", title: "💬 فتح المحادثة" },
            { action: "open_portal", title: "عرض المنظومة" },
          ]
        : [
            { action: "open_portal", title: "عرض المنظومة" },
            { action: "view_details", title: "عرض التفاصيل" },
          ],
  };

  return self.registration.showNotification(title, notificationOptions);
});

// Dual Support: Native Web Push listener for direct VAPID / FCM pushes
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || "منظومة الأستاذة إيمان الدمشيتي";
    const body = data.body || "تنبيه جديد بخصوص الطالب في المنظومة";
    const notifType = data.type || "alert";
    const notifTag = data.tag || data.eventId || `fcm-push-${Date.now()}`;

    const options = {
      body,
      icon: data.icon || "/icon.svg",
      badge: data.badge || "/icon.svg",
      vibrate: [500, 100, 500, 100, 500],
      sound: "/notification.wav",
      silent: false,
      renotify: true,
      requireInteraction: true,
      tag: notifTag,
      actions:
        notifType === "chat"
          ? [
              { action: "open_chat", title: "💬 فتح المحادثة" },
              { action: "open_portal", title: "عرض المنظومة" },
            ]
          : [
              { action: "open_portal", title: "عرض المنظومة" },
              { action: "view_details", title: "عرض التفاصيل" },
            ],
      data: {
        url: data.url || (notifType === "chat" ? "/?tab=chat" : "/"),
        eventId: data.eventId,
        sound: data.sound || "/notification.wav",
        timestamp: data.timestamp || Date.now(),
      },
      dir: "rtl",
      lang: "ar",
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    // Non-JSON push payload fallback
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification("منظومة الأستاذة إيمان الدمشيتي", {
        body: text,
        icon: "/icon.svg",
        vibrate: [500, 100, 500, 100, 500],
        sound: "/notification.wav",
        silent: false,
        renotify: true,
        dir: "rtl",
        lang: "ar",
      })
    );
  }
});

// User click on notification: Focus existing window or open new tab & trigger audio
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const clickData = event.notification.data || {};
  let targetUrl = clickData.url || "/";
  if (event.action === "open_chat") {
    targetUrl = "/?tab=chat";
  } else if (event.action === "view_details") {
    targetUrl = clickData.url || "/?tab=attendance";
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // 1. If an open client window is available, focus it and postMessage to play audio chime
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({
              type: "USER_INTERACTED_PLAY_ALERT",
              sound: clickData.sound || "/notification.wav",
              url: targetUrl,
            });
            if ("navigate" in client && targetUrl) {
              client.navigate(targetUrl);
            }
            return;
          }
        }
        // 2. Otherwise, open a new window to the target URL
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
