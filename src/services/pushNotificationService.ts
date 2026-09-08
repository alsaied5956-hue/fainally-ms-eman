/**
 * Background Push Notification Service
 * Handles Web Push subscriptions, Service Worker background push registration,
 * Periodic Background Sync, and synchronization with Supabase & Firebase Firestore.
 */

import { supabase } from "../utils/supabaseClient";
import { db } from "../utils/firebase";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";

// Standard VAPID Public Key for Web Push (Can also be configured via environment variable)
export const VAPID_PUBLIC_KEY =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY) ||
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBKr3qBUYIHBQFLXYp5Nksh8U";

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
  userRole: "parent" | "student" | "admin" = "parent"
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

    // 4. Check for existing subscription or create a new one
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
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

    // 5. Persist the subscription to database (Supabase + Firestore)
    await savePushSubscription(userId, userRole, subJson);

    return subJson;
  } catch (error) {
    console.error("Failed to register Web Push Subscription:", error);
    return null;
  }
}

/**
 * Persists the client's Push Subscription into both Supabase and Firestore
 * to allow server-side background triggers when the app is completely closed.
 */
export async function savePushSubscription(
  userId: string,
  userRole: string,
  sub: PushSubscriptionData
): Promise<void> {
  const endpoint = sub.endpoint;
  const p256dh = sub.keys.p256dh;
  const auth = sub.keys.auth;
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";

  // 1. Supabase push_subscriptions table
  if (supabase) {
    try {
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          user_role: userRole,
          endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );
    } catch (err) {
      console.warn("Failed saving push subscription to Supabase:", err);
    }
  }

  // 2. Firestore push_subscriptions collection
  if (db) {
    try {
      // Use hash or base64 safe id of endpoint
      const cleanDocId = encodeURIComponent(endpoint).slice(-80);
      await setDoc(
        doc(collection(db, "push_subscriptions"), cleanDocId),
        {
          userId,
          userRole,
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
