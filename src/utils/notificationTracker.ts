/**
 * Notification Deduplication & Lifecycle Tracker
 * Prevents duplicate alerts on initial app load, prevents spamming past messages,
 * and ensures only genuine, real-time incoming updates trigger auditory & visual alerts.
 */

const STORAGE_KEY = "eman_processed_notifications_v1";
const MAX_STORED_IDS = 300;

// Timestamp when current app session initialized
export const SESSION_START_TIME = Date.now();

// In-memory set of processed event IDs
const processedEventIds = new Set<string>();

// Cross-tab broadcast channel
const trackerBus =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel("eman_notif_tracker")
    : null;

// Initialize from LocalStorage
function initTracker(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => {
          if (typeof id === "string") processedEventIds.add(id);
        });
      }
    }
  } catch {}
}

initTracker();

if (trackerBus) {
  trackerBus.addEventListener("message", (ev) => {
    if (ev.data?.type === "MARK_PROCESSED" && typeof ev.data.eventId === "string") {
      processedEventIds.add(ev.data.eventId);
    }
  });
}

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (ev) => {
    if (ev.data?.type === "PUSH_RECEIVED" && typeof ev.data.eventId === "string") {
      processedEventIds.add(ev.data.eventId);
      persistTracker();
    }
  });
}

function persistTracker(): void {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(processedEventIds).slice(-MAX_STORED_IDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

/**
 * Check if a specific notification ID has already been alerted to the user
 */
export function isEventProcessed(eventId: string): boolean {
  if (!eventId) return false;
  return processedEventIds.has(eventId);
}

/**
 * Mark an event ID as processed so it will never alert again
 */
export function markEventProcessed(eventId: string): void {
  if (!eventId) return;
  processedEventIds.add(eventId);
  persistTracker();
  if (trackerBus) {
    trackerBus.postMessage({ type: "MARK_PROCESSED", eventId });
  }
}

/**
 * Evaluates whether an incoming event should trigger a notification.
 * Rules:
 * 1. Forced events (e.g. user clicks "Test chime") always pass.
 * 2. Already-processed events are rejected (0 duplicate re-alerts).
 * 3. Historical events (older than session start by >10s) are silently marked as processed
 *    so opening the app NEVER replays past messages/scans.
 * 4. Genuine real-time updates are accepted, marked as processed, and alerted.
 */
export function shouldNotifyEvent(params: {
  eventId: string;
  timestamp?: number;
  force?: boolean;
}): boolean {
  if (params.force) {
    if (params.eventId) markEventProcessed(params.eventId);
    return true;
  }

  const id = params.eventId;
  if (!id) return false;

  // Rule 2: Already alerted previously?
  if (processedEventIds.has(id)) {
    return false;
  }

  // Rule 3: Is this a historical record from a past session before the app was opened?
  if (params.timestamp && params.timestamp < SESSION_START_TIME - 10000) {
    // Silently mark as seen so future checks skip it without alarming the user
    markEventProcessed(id);
    return false;
  }

  // Rule 4: Genuine new event -> Accept and mark immediately
  markEventProcessed(id);
  return true;
}
