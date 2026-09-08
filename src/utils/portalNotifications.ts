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

/**
 * Play a crystal-clear harmonic chime for instant auditory notification
 */
export function playPortalAudioChime(type: NotificationType): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  try {
    if (type === "attendance") {
      // Pleasant double-chime (D5 -> A5)
      playTone(ctx, 587.33, now, 0.15, "sine", 0.2);
      playTone(ctx, 880.0, now + 0.1, 0.35, "sine", 0.25);
    } else if (type === "absence") {
      // Soft gentle minor notification (E4 -> C4)
      playTone(ctx, 329.63, now, 0.2, "triangle", 0.2);
      playTone(ctx, 261.63, now + 0.15, 0.4, "sine", 0.25);
    } else if (type === "delay") {
      // Warning prompt (F4 -> G4)
      playTone(ctx, 349.23, now, 0.18, "sine", 0.2);
      playTone(ctx, 392.0, now + 0.12, 0.3, "triangle", 0.25);
    } else if (type === "fee") {
      // Harmonic celebratory chime (C5 -> E5 -> G5)
      playTone(ctx, 523.25, now, 0.12, "sine", 0.18);
      playTone(ctx, 659.25, now + 0.08, 0.15, "sine", 0.22);
      playTone(ctx, 783.99, now + 0.16, 0.35, "sine", 0.26);
    } else if (type === "grade") {
      // Ascending success arpeggio (G4 -> C5 -> E5 -> G5)
      playTone(ctx, 392.0, now, 0.1, "sine", 0.18);
      playTone(ctx, 523.25, now + 0.08, 0.1, "sine", 0.2);
      playTone(ctx, 659.25, now + 0.16, 0.12, "sine", 0.22);
      playTone(ctx, 783.99, now + 0.24, 0.4, "sine", 0.28);
    } else if (type === "chat") {
      // Soft modern message bubble pop-chime (F5 -> C6)
      playTone(ctx, 698.46, now, 0.08, "sine", 0.2);
      playTone(ctx, 1046.5, now + 0.06, 0.25, "sine", 0.22);
    } else {
      // General alert chime
      playTone(ctx, 440.0, now, 0.25, "sine", 0.2);
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
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return "denied";
  }
  try {
    const perm = await Notification.requestPermission();
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
  // 1. Play audio chime if not explicitly muted
  if (options?.sound !== false) {
    playPortalAudioChime(type);
  }

  // 2. Display system-level push notification if permitted
  if (isNotificationSupported() && Notification.permission === "granted") {
    try {
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: "/icon.svg",
            badge: "/icon.svg",
            tag: `portal-${Date.now()}`,
            data: { url: options?.url || "/" },
            dir: "rtl",
            lang: "ar",
          });
          return;
        }
      }

      // Fallback to standard Notification API
      new Notification(title, {
        body,
        icon: "/icon.svg",
        dir: "rtl",
        lang: "ar",
      });
    } catch (err) {
      console.warn("Notification display warning:", err);
    }
  }
}
