/**
 * Background Push Notification Service
 * Handles Web Push subscriptions, Service Worker background push registration,
 * Periodic Background Sync, and synchronization with Supabase & Firebase Firestore.
 */

import { supabase } from "../utils/supabaseClient";
import { db } from "../utils/firebase";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { markEventProcessed } from "../utils/notificationTracker";

// Standard VAPID Public Key matching the backend server
export const VAPID_PUBLIC_KEY =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY) ||
  "BE0N1wV5fSDpg0YAO8uoPXzWpBYJznOLFcF05uh8P-Du7NMgWpbcafllzDXaeDp8FPAXkS6p50KE0v9SfDHNZXQ";

/**
 * Converts a base64 string to a Uint8Array for pushManager.subscribe applicationServerKey
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Registers the Service Worker and requests a Push Subscription from the browser push service (FCM / Mozilla / Apple).
 * Works reliably when the application is completely closed or in the background.
 */
export async function registerPushSubscription(
  userId: string,
  userRole: "parent" | "student" | "admin" = "parent",
  aliases: string[] = []
): Promise<PushSubscriptionData | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Web Push is not supported in this browser environment.");
    return null;
  }

  try {
    // 1. Request Notification Permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("Notification permission was denied or dismissed.");
      return null;
    }

    // 2. Register or retrieve active Service Worker
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
    await navigator.serviceWorker.ready;

    // 3. Register Periodic Background Sync if supported (PWA background capability)
    try {
      if ("periodicSync" in registration) {
        const periodicSync = (registration as any).periodicSync;
        const tags = await periodicSync.getTags();
        if (!tags.includes("attendance-schedule-check")) {
          await periodicSync.register("attendance-schedule-check", {
            minInterval: 12 * 60 * 60 * 1000, // 12 hours check
          });
        }
      }
    } catch {
      // Periodic sync is optional and depends on browser PWA installation
    }

    // 4. Retrieve VAPID Key (dynamically from server or fallback constant)
    let activeVapidKey = VAPID_PUBLIC_KEY;
    try {
      const res = await fetch("/api/push-public-key");
      if (res.ok) {
        const data = await res.json();
        if (data?.publicKey) activeVapidKey = data.publicKey;
      }
    } catch {}

    const convertedKey = urlBase64ToUint8Array(activeVapidKey);

    // 5. Check for existing subscription or create a new one
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      // Verify subscription applicationServerKey matches current server key
      try {
        const rawKey = subscription.options?.applicationServerKey;
        if (rawKey) {
          const keyArr = new Uint8Array(rawKey);
          let match = keyArr.length === convertedKey.length;
          if (match) {
            for (let i = 0; i < keyArr.length; i++) {
              if (keyArr[i] !== convertedKey[i]) {
                match = false;
                break;
              }
            }
          }
          if (!match) {
            console.log("Renewing Web Push subscription for updated server VAPID key...");
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      } catch {}
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
    }

    const subJson = subscription.toJSON() as PushSubscriptionData;
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      console.warn("Invalid push subscription payload generated.");
      return null;
    }

    // 6. Persist the subscription to backend server + database
    await savePushSubscription(userId, userRole, subJson, aliases);

    return subJson;
  } catch (error) {
    console.error("Failed to register Web Push Subscription:", error);
    return null;
  }
}

/**
 * Persists the client's Push Subscription into Backend Server, Firestore, and Supabase
 * so background triggers can reach the phone even when app is closed.
 */
export async function savePushSubscription(
  userId: string,
  userRole: string,
  sub: PushSubscriptionData,
  aliases: string[] = []
): Promise<void> {
  const endpoint = sub.endpoint;
  const p256dh = sub.keys.p256dh;
  const auth = sub.keys.auth;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const cleanAliases = Array.isArray(aliases) ? aliases.map(String).filter(Boolean) : [];

  // 1. Primary Backend Express API (for instant web-push sending)
  try {
    await fetch("/api/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        userRole,
        aliases: cleanAliases,
        subscription: sub,
      }),
    });
  } catch (err) {
    console.warn("Could not register push to Express backend:", err);
  }

  // 2. Firestore push_subscriptions collection
  if (db) {
    try {
      const cleanDocId = encodeURIComponent(endpoint).slice(-80);
      await setDoc(
        doc(collection(db, "push_subscriptions"), cleanDocId),
        {
          userId,
          userRole,
          aliases: cleanAliases,
          endpoint,
          p256dh,
          auth,
          userAgent,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Failed saving push subscription to Firestore:", err);
    }
  }
}

/**
 * Dispatches a native Web Push notification to target users (e.g. parents of a student).
 * This awakens the recipient's phone/browser via Google/Apple push even if the app is completely closed!
 */
export async function dispatchPushNotification(payload: {
  targetUserIds?: string | string[];
  role?: "parent" | "admin" | "all";
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
  eventId?: string;
  type?: string;
}): Promise<boolean> {
  const eventId = payload.eventId || `ev-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  
  // Pre-mark locally so this client doesn't double-alert
  markEventProcessed(eventId);

  try {
    const res = await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        eventId,
      }),
    });

    if (res.ok) {
      return true;
    }
  } catch (err) {
    console.warn("dispatchPushNotification network warning:", err);
  }
  return false;
}

/**
 * Helper to dispatch a local background alert via Service Worker
 * (Plays acoustic chime, triggers mobile vibration, rings device sound)
 */
export async function triggerDeviceBackgroundAlert(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.showNotification) {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: "/icon.svg",
        badge: "/icon.svg",
        vibrate: [300, 100, 300, 100, 400],
        silent: false,
        renotify: true,
        requireInteraction: true,
        tag: payload.tag || `eman-alert-${Date.now()}`,
        data: {
          url: payload.url || "/",
          timestamp: Date.now(),
        },
        dir: "rtl",
        lang: "ar",
      } as any);
    }
  } catch (err) {
    console.warn("ServiceWorker trigger alert failed:", err);
  }
}
