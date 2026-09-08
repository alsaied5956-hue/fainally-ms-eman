/**
 * Web Audio Synthesizer & Push Notification Manager for Parents & Admins Portal
 * Synthesizes pure harmonic acoustic chimes via Web Audio API (zero external asset dependencies).
 */

export type NotificationType =
  | "attendance"
  | "absence"
  | "delay"
  | "fee"
  | "grade"
  | "chat"
  | "alert";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedAudioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        sharedAudioCtx = new AudioCtxClass();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Auto-unlock audio context on first user interaction so sound can play smoothly on mobile phones
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch {}
  };
  window.addEventListener("click", unlockAudio, { passive: true });
  window.addEventListener("touchstart", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });
}

/**
 * Play a crystal-clear, high-volume harmonic chime for instant auditory notification
 */
export function playPortalAudioChime(type: NotificationType): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  } catch {}

  const now = ctx.currentTime;

  try {
    if (type === "attendance") {
      // Pleasant clear double-chime (D5 -> A5)
      playTone(ctx, 587.33, now, 0.18, "sine", 0.4);
      playTone(ctx, 880.0, now + 0.12, 0.45, "sine", 0.5);
    } else if (type === "absence") {
      // Soft gentle minor alert (E4 -> C4)
      playTone(ctx, 329.63, now, 0.22, "triangle", 0.4);
      playTone(ctx, 261.63, now + 0.16, 0.45, "sine", 0.45);
    } else if (type === "delay") {
      // Warning prompt (F4 -> G4)
      playTone(ctx, 349.23, now, 0.2, "sine", 0.4);
      playTone(ctx, 392.0, now + 0.14, 0.35, "triangle", 0.45);
    } else if (type === "fee") {
      // Harmonic celebratory chime (C5 -> E5 -> G5)
      playTone(ctx, 523.25, now, 0.15, "sine", 0.35);
      playTone(ctx, 659.25, now + 0.1, 0.18, "sine", 0.4);
      playTone(ctx, 783.99, now + 0.2, 0.45, "sine", 0.5);
    } else if (type === "grade") {
      // Ascending success arpeggio (G4 -> C5 -> E5 -> G5)
      playTone(ctx, 392.0, now, 0.12, "sine", 0.35);
      playTone(ctx, 523.25, now + 0.1, 0.12, "sine", 0.4);
      playTone(ctx, 659.25, now + 0.18, 0.14, "sine", 0.45);
      playTone(ctx, 783.99, now + 0.26, 0.5, "sine", 0.55);
    } else if (type === "chat") {
      // Soft modern message bubble pop-chime (F5 -> C6)
      playTone(ctx, 698.46, now, 0.1, "sine", 0.4);
      playTone(ctx, 1046.5, now + 0.08, 0.3, "sine", 0.45);
    } else {
      // General alert chime
      playTone(ctx, 440.0, now, 0.3, "sine", 0.4);
      playTone(ctx, 660.0, now + 0.15, 0.4, "sine", 0.45);
    }
  } catch (err) {
    console.warn("Audio chime error:", err);
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  waveType: OscillatorType,
  volume: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = waveType;
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

/**
 * Check if Web Notifications are supported
 */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Request permission for web push notifications
 */
export async function requestNotificationPermission(
  userId?: string,
  userRole: "parent" | "student" | "admin" = "parent"
): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return "denied";
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted" && userId) {
      import("../services/pushNotificationService")
        .then(({ registerPushSubscription }) => {
          registerPushSubscription(userId, userRole).catch(() => {});
        })
        .catch(() => {});
    }
    return perm;
  } catch {
    return "denied";
  }
}

/**
 * Send an instantaneous in-app or system push notification with audio alert
 */
export async function sendPortalNotification(
  title: string,
  body: string,
  type: NotificationType = "alert",
  options?: { url?: string; sound?: boolean }
): Promise<void> {
  // 1. Play acoustic chime if not explicitly muted
  if (options?.sound !== false) {
    playPortalAudioChime(type);
  }

  // 2. Trigger mobile phone physical vibration if hardware supports it
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([250, 100, 250, 100, 350]);
    } catch {}
  }

  // 3. Display system-level push notification if permitted
  if (isNotificationSupported() && Notification.permission === "granted") {
    const vibratePattern = [300, 100, 300, 100, 400];
    const targetUrl = options?.url || "/";

    // A. Service Worker Registration (Required on Android Chrome, highly reliable across all mobile browsers)
    if ("serviceWorker" in navigator) {
      try {
        let reg = await navigator.serviceWorker.getRegistration();
        if (!reg) {
          reg = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
        }

        if (reg && typeof reg.showNotification === "function") {
          await reg.showNotification(title, {
            body,
            icon: "/icon.svg",
            badge: "/icon.svg",
            vibrate: vibratePattern,
            silent: false, // Rings the phone's native notification sound
            renotify: true, // Guarantees new sound even if previous notif is unread
            requireInteraction: true,
            tag: `eman-${type}-${Date.now()}`,
            data: { url: targetUrl },
            dir: "rtl",
            lang: "ar",
          } as any);

          // Also post message to Service Worker controller for background tracking
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: "SHOW_PORTAL_NOTIFICATION",
              title,
              body,
              icon: "/icon.svg",
              badge: "/icon.svg",
              vibrate: vibratePattern,
              url: targetUrl,
              tag: `eman-${type}-${Date.now()}`,
            });
          }
          return;
        }
      } catch (err) {
        console.warn("ServiceWorker showNotification failed:", err);
      }
    }

    // B. Standard Notification fallback (for desktop Safari/Edge/Firefox)
    try {
      new Notification(title, {
        body,
        icon: "/icon.svg",
        silent: false,
        dir: "rtl",
        lang: "ar",
      });
    } catch (err) {
      console.warn("Desktop Notification fallback failed:", err);
    }
  }
}
